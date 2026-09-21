use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{Arc, RwLock},
    time::UNIX_EPOCH,
};
use tauri::{
    http::{header::CONTENT_TYPE, Response, StatusCode},
    Emitter, Manager, State,
};
use uuid::Uuid;

const MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 256_000_000;

type AssetStore = Arc<RwLock<HashMap<String, PathBuf>>>;

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
fn register_asset(
    document_path: String,
    relative_path: String,
    assets: State<'_, AssetStore>,
) -> Result<String, String> {
    let document = validate_local_path(&document_path)?;
    let relative = Path::new(relative_path.trim());
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Image paths must stay inside the document directory".into());
    }
    let parent = document.parent().ok_or("Document has no parent folder")?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    let target = fs::canonicalize(parent.join(relative)).map_err(|error| error.to_string())?;
    if !target.starts_with(&canonical_parent) || !target.is_file() {
        return Err("Image path is outside the document directory or does not exist".into());
    }
    let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err("Image exceeds the 64 MiB limit".into());
    }
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
            if name.starts_with('.') {
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
    if inputs.is_empty() || inputs.len() > 100 {
        return Err("Select between 1 and 100 images".into());
    }
    let total: usize = inputs.iter().map(|input| input.bytes.len()).sum();
    if total > 256 * 1024 * 1024
        || inputs
            .iter()
            .any(|input| input.bytes.len() > MAX_IMAGE_BYTES)
    {
        return Err("Images are limited to 64 MiB each and 256 MiB per batch".into());
    }
    let folder = folder.trim();
    let assets = asset_directory(&document, folder)?;
    let mut destinations = Vec::new();
    for input in inputs {
        let reader = image::ImageReader::new(std::io::Cursor::new(&input.bytes))
            .with_guessed_format()
            .map_err(|error| error.to_string())?;
        let dimensions = reader
            .into_dimensions()
            .map_err(|error| error.to_string())?;
        if (dimensions.0 as u64) * (dimensions.1 as u64) > MAX_IMAGE_PIXELS {
            return Err("Image exceeds the pixel limit".into());
        }
        let stem = input
            .name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("image")
            .rsplit_once('.')
            .map(|pair| pair.0)
            .unwrap_or("image")
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                    character
                } else {
                    '-'
                }
            })
            .collect::<String>();
        let extension = input
            .name
            .rsplit_once('.')
            .map(|pair| pair.1.to_ascii_lowercase())
            .filter(|extension| {
                matches!(
                    extension.as_str(),
                    "png" | "jpg" | "jpeg" | "gif" | "webp" | "tif" | "tiff" | "avif"
                )
            })
            .unwrap_or_else(|| "png".into());
        let filename = format!(
            "{}-{}.{}",
            if stem.is_empty() { "image" } else { &stem },
            &Uuid::new_v4().to_string()[..12],
            extension
        );
        let target = assets.join(&filename);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| error.to_string())?;
        if let Err(error) = file.write_all(&input.bytes).and_then(|_| file.sync_all()) {
            let _ = fs::remove_file(&target);
            return Err(error.to_string());
        }
        destinations.push(format!("{}/{}", folder.replace('\\', "/"), filename));
    }
    Ok(destinations)
}

pub fn run() {
    let assets: AssetStore = Arc::new(RwLock::new(HashMap::new()));
    let protocol_assets = Arc::clone(&assets);
    tauri::Builder::default()
        .manage(assets)
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
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = argv.into_iter().skip(1).find(|value| {
                value.ends_with(".md")
                    || value.ends_with(".markdown")
                    || value.ends_with(".mdown")
                    || value.ends_with(".mkd")
            }) {
                let _ = app.emit("open-file", path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            save_document,
            export_html,
            register_asset,
            list_directory,
            extract_outline,
            validate_image,
            import_images
        ])
        .setup(|app| {
            let _ = app.path().app_config_dir();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Markit");
}
