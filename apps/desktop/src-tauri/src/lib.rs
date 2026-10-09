mod resources;
use resources::{export_zip, optional_file_revision, read_image, save_document_copy};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::UNIX_EPOCH,
};
use tauri::{
    http::{header::CONTENT_TYPE, Response, StatusCode},
    AppHandle, Emitter, Manager, State,
};
use uuid::Uuid;

const MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 256_000_000;
const MAX_PLUGIN_PACKAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RECOVERY_BYTES: usize = 64 * 1024 * 1024;

type AssetStore = Arc<RwLock<HashMap<String, PathBuf>>>;

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

fn queue_open_paths(app: &AppHandle, paths: impl Iterator<Item = PathBuf>) {
    let state = app.state::<PendingOpenPaths>();
    if let Ok(mut pending) = state.0.lock() {
        for path in paths {
            if !path.extension().is_some_and(|extension| {
                ["md", "markdown", "mdown", "mkd", "txt"]
                    .iter()
                    .any(|kind| extension.eq_ignore_ascii_case(kind))
            }) {
                continue;
            }
            if let Ok(path) = fs::canonicalize(path) {
                let path = path.to_string_lossy().into_owned();
                #[cfg(windows)]
                let path = if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
                    format!(r"\\{}", unc)
                } else {
                    path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
                };
                if pending.len() < 100 && !pending.contains(&path) {
                    pending.push(path);
                }
            }
        }
    };
    let _ = app.emit("open-file", "");
}

#[tauri::command]
fn take_open_paths(paths: State<'_, PendingOpenPaths>) -> Result<Vec<String>, String> {
    let mut pending = paths.0.lock().map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileRevision {
    pub hash: String,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub anchor: usize,
    pub head: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub id: String,
    pub path: Option<String>,
    pub title: String,
    pub source: String,
    pub saved_source: String,
    pub dirty: bool,
    pub revision: Option<FileRevision>,
    pub bom: bool,
    pub line_ending: String,
    pub mode: String,
    pub selection: Selection,
    pub scroll_top: f64,
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("recovery.json"))
}

#[tauri::command]
fn read_recovery(app: AppHandle) -> Result<Vec<DocumentSnapshot>, String> {
    let path = recovery_path(&app)?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    if bytes.len() > MAX_RECOVERY_BYTES {
        return Err("Recovery data exceeds the 64 MiB limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_recovery(app: AppHandle, documents: Vec<DocumentSnapshot>) -> Result<(), String> {
    if documents.len() > 100 {
        return Err("Recovery data contains too many documents".into());
    }
    let bytes = serde_json::to_vec(&documents).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_RECOVERY_BYTES {
        return Err("Recovery data exceeds the 64 MiB limit".into());
    }
    let path = recovery_path(&app)?;
    write_atomic(&path, &bytes)
}

#[tauri::command]
fn clear_recovery(app: AppHandle) -> Result<(), String> {
    let path = recovery_path(&app)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub directory: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineEntry {
    pub id: String,
    pub text: String,
    pub level: u8,
    pub offset: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    pub name: String,
    pub bytes: Vec<u8>,
}

fn validate_local_path(raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() || raw.bytes().any(|byte| byte == 0 || byte < 0x20) {
        return Err("Invalid local path".into());
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("A local absolute path is required".into());
    }
    Ok(path)
}

fn asset_directory(document: &Path, folder: &str) -> Result<PathBuf, String> {
    if folder.trim().is_empty() || folder.contains('\0') {
        return Err("Image folder must be relative to the document".into());
    }
    let relative = Path::new(folder);
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("Image folder cannot escape the document directory".into());
    }
    let parent = document.parent().ok_or("Document has no parent folder")?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    let target = parent.join(relative);
    fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    let canonical_target = fs::canonicalize(&target).map_err(|error| error.to_string())?;
    if !canonical_target.starts_with(&canonical_parent) {
        return Err("Image folder cannot escape the document directory".into());
    }
    Ok(canonical_target)
}

fn asset_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "tif" | "tiff" => "image/tiff",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

fn revision(path: &Path, bytes: &[u8]) -> Result<FileRevision, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(FileRevision {
        hash: format!("{:x}", hasher.finalize()),
        size: bytes.len() as u64,
        modified_ms,
    })
}

fn decode_source(bytes: &[u8]) -> Result<(String, bool), String> {
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let content = if bom { &bytes[3..] } else { bytes };
    let source = String::from_utf8(content.to_vec())
        .map_err(|_| "Markit currently supports UTF-8 Markdown files".to_string())?;
    Ok((source.replace("\r\n", "\n").replace('\r', "\n"), bom))
}

fn detect_line_ending(bytes: &[u8]) -> &'static str {
    let crlf = bytes.windows(2).filter(|pair| *pair == b"\r\n").count();
    let lf = bytes
        .iter()
        .filter(|byte| **byte == b'\n')
        .count()
        .saturating_sub(crlf);
    if crlf > lf {
        "CRLF"
    } else {
        "LF"
    }
}

#[tauri::command]
fn read_document(path: String) -> Result<DocumentSnapshot, String> {
    let path = validate_local_path(&path)?;
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err("Document is too large for the live editor".into());
    }
    let (source, bom) = decode_source(&bytes)?;
    let title = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_string();
    Ok(DocumentSnapshot {
        id: Uuid::new_v4().to_string(),
        path: Some(path.to_string_lossy().into_owned()),
        title,
        source: source.clone(),
        saved_source: source,
        dirty: false,
        revision: Some(revision(&path, &bytes)?),
        bom,
        line_ending: detect_line_ending(&bytes).into(),
        mode: "live".into(),
        selection: Selection { anchor: 0, head: 0 },
        scroll_top: 0.0,
    })
}

#[tauri::command]
fn save_document(
    path: String,
    source: String,
    expected: Option<FileRevision>,
    bom: bool,
    line_ending: String,
) -> Result<FileRevision, String> {
    let path = validate_local_path(&path)?;
    let existed = path.exists();
    let current = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error.to_string()),
    };
    if let Some(expected) = expected {
        if !existed {
            return Err("The file was removed before saving.".into());
        }
        let actual = revision(&path, &current)?;
        if actual.hash != expected.hash || actual.size != expected.size {
            return Err("The file changed on disk. Reload it before saving.".into());
        }
    }
    let mut bytes = if line_ending == "CRLF" {
        source.replace('\n', "\r\n").into_bytes()
    } else {
        source.into_bytes()
    };
    if bom {
        bytes.splice(0..0, [0xef, 0xbb, 0xbf]);
    }
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err("Document is too large to save".into());
    }
    let temporary = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("markit"),
        Uuid::new_v4()
    ));
    {
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        error.to_string()
    })?;
    revision(&path, &bytes)
}

#[tauri::command]
fn get_file_revision(path: String) -> Result<FileRevision, String> {
    let path = validate_local_path(&path)?;
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    revision(&path, &bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("markit"),
        Uuid::new_v4()
    ));
    let result = (|| {
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
fn export_html(path: String, html: String) -> Result<(), String> {
    let path = validate_local_path(&path)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "html" | "htm") {
        return Err("HTML exports must use a .html or .htm filename".into());
    }
    let bytes = html.into_bytes();
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err("The exported HTML is too large".into());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    write_atomic(&path, &bytes)
}

#[tauri::command]
fn export_png(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = validate_local_path(&path)?;
    if path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        != "png"
    {
        return Err("PNG exports must use a .png filename".into());
    }
    if bytes.is_empty() || bytes.len() > MAX_EXPORT_BYTES {
        return Err("The exported PNG is empty or too large".into());
    }
    if !bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Err("PNG export data has an invalid signature".into());
    }
    let image = image::ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?
        .decode()
        .map_err(|error| format!("Invalid PNG export: {error}"))?;
    let pixels = u64::from(image.width()) * u64::from(image.height());
    if pixels > MAX_IMAGE_PIXELS {
        return Err("The exported PNG exceeds the pixel limit".into());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    write_atomic(&path, &bytes)
}

#[tauri::command]
fn register_asset(
    document_path: String,
    relative_path: String,
    assets: State<'_, AssetStore>,
    roots: Option<Vec<String>>,
) -> Result<String, String> {
    let document = validate_local_path(&document_path)?;
    let target = resources::resolve_asset(&document, &relative_path, &roots.unwrap_or_default())?;
    let token = Uuid::new_v4().simple().to_string();
    let mut store = assets
        .write()
        .map_err(|_| "Image registry is unavailable".to_string())?;
    if store.len() >= 1024 {
        store.clear();
    }
    store.insert(token.clone(), target);
    Ok(format!("markit-asset://localhost/{}", token))
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let path = validate_local_path(&path)?;
    let mut entries = fs::read_dir(&path)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || (metadata.is_dir() && entry.file_type().ok()?.is_symlink())
            {
                return None;
            }
            Some(DirectoryEntry {
                name,
                path: entry.path().to_string_lossy().into_owned(),
                directory: metadata.is_dir(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| (!entry.directory, entry.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
fn extract_outline(source: String) -> Vec<OutlineEntry> {
    let mut offset = 0usize;
    let mut result = Vec::new();
    for line in source.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        let level = trimmed
            .chars()
            .take_while(|character| *character == '#')
            .count();
        if (1..=6).contains(&level) && trimmed.chars().nth(level) == Some(' ') {
            let text = trimmed[level + 1..]
                .trim()
                .trim_end_matches('#')
                .trim()
                .to_string();
            result.push(OutlineEntry {
                id: format!("heading-{}", result.len()),
                text,
                level: level as u8,
                offset,
            });
        }
        // JavaScript selection offsets are UTF-16 code units, not UTF-8 bytes.
        offset += line.encode_utf16().count();
    }
    result
}

#[tauri::command]
fn validate_image(bytes: Vec<u8>) -> Result<(u32, u32, String), String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image exceeds the 64 MiB limit".into());
    }
    let reader = image::ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let dimensions = reader
        .into_dimensions()
        .map_err(|error| error.to_string())?;
    if (dimensions.0 as u64) * (dimensions.1 as u64) > MAX_IMAGE_PIXELS {
        return Err("Image exceeds the pixel limit".into());
    }
    Ok((dimensions.0, dimensions.1, "validated".into()))
}

#[tauri::command]
fn import_images(
    document_path: String,
    folder: String,
    inputs: Vec<ImageInput>,
) -> Result<Vec<String>, String> {
    let document = validate_local_path(&document_path)?;
    resources::import(&document, folder.trim(), inputs)
}

#[tauri::command]
fn read_plugin_package(path: String) -> Result<Vec<u8>, String> {
    let path = validate_local_path(&path)?;
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("markit-plugin"))
        != Some(true)
    {
        return Err("Select a .markit-plugin package".into());
    }
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_PLUGIN_PACKAGE_BYTES {
        return Err("Plugin package exceeds the 64 MiB limit".into());
    }
    fs::read(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_resource(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = validate_local_path(&path)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

pub fn run() {
    let assets: AssetStore = Arc::new(RwLock::new(HashMap::new()));
    let protocol_assets = Arc::clone(&assets);
    tauri::Builder::default()
        .manage(assets)
        .manage(PendingOpenPaths::default())
        .register_uri_scheme_protocol("markit-asset", move |_context, request| {
            let token = request.uri().path().trim_start_matches('/');
            let path = protocol_assets
                .read()
                .ok()
                .and_then(|store| store.get(token).cloned());
            let Some(path) = path else {
                return Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap();
            };
            match fs::read(&path) {
                Ok(bytes) => Response::builder()
                    .header(CONTENT_TYPE, asset_content_type(&path))
                    .body(bytes)
                    .unwrap(),
                Err(_) => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            queue_open_paths(
                app,
                argv.into_iter()
                    .skip(1)
                    .map(|path| Path::new(&cwd).join(path)),
            );
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            take_open_paths,
            save_document,
            get_file_revision,
            read_recovery,
            write_recovery,
            clear_recovery,
            export_html,
            export_png,
            register_asset,
            list_directory,
            extract_outline,
            validate_image,
            import_images,
            read_image,
            save_document_copy,
            optional_file_revision,
            export_zip,
            read_plugin_package,
            open_resource
        ])
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            queue_open_paths(
                app.handle(),
                std::env::args().skip(1).map(|path| cwd.join(path)),
            );
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Markit")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                queue_open_paths(
                    _app,
                    urls.into_iter().filter_map(|url| url.to_file_path().ok()),
                );
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_directory(label: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("markit-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create temporary directory");
        directory
    }

    #[test]
    fn decodes_utf8_bom_and_normalizes_line_endings() {
        let bytes = [0xef, 0xbb, 0xbf, b'a', b'\r', b'\n', b'b', b'\r', b'c'];
        assert_eq!(decode_source(&bytes).unwrap(), ("a\nb\nc".into(), true));
        assert_eq!(detect_line_ending(b"a\r\nb\r\nc\n"), "CRLF");
        assert_eq!(detect_line_ending(b"a\nb\nc\r"), "LF");
        assert!(decode_source(&[0xff, 0xfe]).is_err());
    }

    #[test]
    fn validates_absolute_paths_and_rejects_control_characters() {
        let absolute = std::env::temp_dir().join("document.md");
        assert_eq!(
            validate_local_path(absolute.to_str().unwrap()).unwrap(),
            absolute
        );
        assert!(validate_local_path("document.md").is_err());
        assert!(validate_local_path("/tmp/document\n.md").is_err());
        assert!(validate_local_path("").is_err());
    }

    #[test]
    fn saves_with_bom_and_crlf_and_detects_external_changes() {
        let directory = temporary_directory("save");
        let path = directory.join("note.md");
        let first = save_document(
            path.to_string_lossy().into_owned(),
            "# Title\n\nText\n".into(),
            None,
            true,
            "CRLF".into(),
        )
        .unwrap();
        assert_eq!(
            fs::read(&path).unwrap(),
            b"\xef\xbb\xbf# Title\r\n\r\nText\r\n"
        );
        let snapshot = read_document(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(snapshot.source, "# Title\n\nText\n");
        assert_eq!(snapshot.line_ending, "CRLF");
        assert_eq!(snapshot.revision.as_ref().unwrap().hash, first.hash);
        fs::write(&path, b"changed outside Markit\n").unwrap();
        let result = save_document(
            path.to_string_lossy().into_owned(),
            "new\n".into(),
            snapshot.revision,
            false,
            "LF".into(),
        );
        assert!(result.unwrap_err().contains("changed on disk"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn outline_offsets_count_utf16_code_units() {
        let source = "# 中文\n\n## 第二节\n";
        let entries = extract_outline(source.into());
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].offset, 0);
        assert_eq!(entries[1].offset, "# 中文\n\n".encode_utf16().count());
        assert_eq!(entries[1].text, "第二节");
    }

    #[test]
    fn blocks_asset_escape_and_invalid_exports() {
        let directory = temporary_directory("paths");
        let document = directory.join("note.md");
        fs::write(&document, b"# note").unwrap();
        assert!(asset_directory(&document, "../outside").is_err());
        assert!(asset_directory(&document, "/tmp/outside").is_err());
        assert!(export_html(
            directory.join("note.txt").to_string_lossy().into_owned(),
            "<p>x</p>".into()
        )
        .is_err());
        export_html(
            directory.join("out.html").to_string_lossy().into_owned(),
            "<p>x</p>".into(),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(directory.join("out.html")).unwrap(),
            "<p>x</p>"
        );
        let mut png = Vec::new();
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        export_png(
            directory.join("out.png").to_string_lossy().into_owned(),
            png.clone(),
        )
        .unwrap();
        assert_eq!(fs::read(directory.join("out.png")).unwrap(), png);
        assert!(export_png(
            directory.join("out.jpg").to_string_lossy().into_owned(),
            png
        )
        .is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_invalid_images_before_import() {
        assert!(validate_image(Vec::new()).is_err());
        assert!(validate_image(vec![1, 2, 3, 4]).is_err());
        let directory = temporary_directory("images");
        let document = directory.join("note.md");
        fs::write(&document, b"# note").unwrap();
        let result = import_images(
            document.to_string_lossy().into_owned(),
            "../escape".into(),
            vec![ImageInput {
                name: "x.png".into(),
                bytes: vec![1, 2, 3],
            }],
        );
        assert!(result.is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
