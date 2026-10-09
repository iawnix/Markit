use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetFile {
    pub relative_path: String,
    pub bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub name: String,
    pub bytes: Vec<u8>,
    pub mime: String,
}

pub fn resolve_asset(document: &Path, relative: &str, roots: &[String]) -> Result<PathBuf, String> {
    if relative.is_empty() || relative.contains('\0') || relative.contains("://") {
        return Err("Invalid image path".into());
    }
    let parent = fs::canonicalize(document.parent().ok_or("Document has no parent folder")?)
        .map_err(|error| error.to_string())?;
    let target = fs::canonicalize(parent.join(relative))
        .map_err(|error| format!("Image not found: {relative} ({error})"))?;
    let permitted = target.starts_with(&parent)
        || roots
            .iter()
            .filter_map(|root| fs::canonicalize(root).ok())
            .any(|root| root.is_dir() && target.starts_with(root));
    if !permitted {
        return Err(format!(
            "Image access requires choosing its containing folder: {relative}"
        ));
    }
    if !target.is_file()
        || fs::metadata(&target)
            .map_err(|error| error.to_string())?
            .len()
            > MAX_IMAGE_BYTES as u64
    {
        return Err(format!("Image is missing or exceeds 64 MiB: {relative}"));
    }
    Ok(target)
}

fn inspect(bytes: &[u8]) -> Result<image::ImageFormat, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("Images are limited to 64 MiB each".into());
    }
    let format = image::guess_format(bytes).map_err(|error| error.to_string())?;
    if !matches!(
        format,
        image::ImageFormat::Png
            | image::ImageFormat::Jpeg
            | image::ImageFormat::Gif
            | image::ImageFormat::WebP
            | image::ImageFormat::Tiff
            | image::ImageFormat::Avif
    ) {
        return Err("Unsupported image format".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let dimensions = image::ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|error| error.to_string())?;
    if u64::from(dimensions.0) * u64::from(dimensions.1) > MAX_IMAGE_PIXELS {
        return Err("Image exceeds the pixel limit".into());
    }
    reader.decode().map_err(|error| error.to_string())?;
    Ok(format)
}

#[tauri::command]
pub fn read_image(
    document_path: String,
    relative_path: String,
    roots: Option<Vec<String>>,
) -> Result<ImageData, String> {
    let document = validate_local_path(&document_path)?;
    let target = resolve_asset(&document, &relative_path, &roots.unwrap_or_default())?;
    let bytes = fs::read(&target).map_err(|error| error.to_string())?;
    let format = inspect(&bytes)?;
    Ok(ImageData {
        name: target
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        bytes,
        mime: format.to_mime_type().into(),
    })
}

pub fn rollback(written: &[PathBuf]) {
    for target in written.iter().rev() {
        let _ = fs::remove_file(target);
    }
}

/// Validate the whole batch before creating directories or writing any file.
pub fn write_assets(document: &Path, assets: Vec<AssetFile>) -> Result<Vec<PathBuf>, String> {
    if assets.len() > 100
        || assets.iter().map(|asset| asset.bytes.len()).sum::<usize>() > 256 * 1024 * 1024
    {
        return Err("Images are limited to 100 files and 256 MiB per batch".into());
    }
    for asset in &assets {
        let relative = Path::new(&asset.relative_path);
        if relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
            || relative.file_name().is_none()
        {
            return Err("Invalid attachment path".into());
        }
        inspect(&asset.bytes)?;
    }
    let mut written = Vec::new();
    let result = (|| {
        for asset in assets {
            let relative = Path::new(&asset.relative_path);
            let folder = relative
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
                .ok_or("Attachments need a resource folder")?;
            let directory = asset_directory(document, &folder.to_string_lossy())?;
            let target = directory.join(relative.file_name().unwrap());
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|error| error.to_string())?;
            written.push(target);
            file.write_all(&asset.bytes)
                .and_then(|_| file.sync_all())
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        rollback(&written);
        return Err(error);
    }
    Ok(written)
}

pub fn import(
    document: &Path,
    folder: &str,
    inputs: Vec<ImageInput>,
) -> Result<Vec<String>, String> {
    if inputs.is_empty()
        || inputs.len() > 100
        || inputs.iter().map(|input| input.bytes.len()).sum::<usize>() > 256 * 1024 * 1024
    {
        return Err("Select up to 100 images totaling at most 256 MiB".into());
    }
    let mut assets = Vec::new();
    for input in inputs {
        let format = image::guess_format(&input.bytes).map_err(|error| error.to_string())?;
        let stem = Path::new(&input.name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .take(60)
            .collect::<String>();
        let filename = format!(
            "{}-{}.{}",
            if stem.is_empty() { "image" } else { &stem },
            &Uuid::new_v4().to_string()[..12],
            format.extensions_str()[0]
        );
        assets.push(AssetFile {
            relative_path: format!("{}/{}", folder.replace('\\', "/"), filename),
            bytes: input.bytes,
        });
    }
    let paths = assets
        .iter()
        .map(|asset| asset.relative_path.clone())
        .collect();
    write_assets(document, assets)?;
    Ok(paths)
}

#[tauri::command]
pub fn optional_file_revision(path: String) -> Result<Option<FileRevision>, String> {
    let path = validate_local_path(&path)?;
    match fs::read(&path) {
        Ok(bytes) => Ok(Some(revision(&path, &bytes)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn save_document_copy(
    path: String,
    source: String,
    assets: Vec<AssetFile>,
    expected: Option<FileRevision>,
    bom: bool,
    line_ending: String,
) -> Result<FileRevision, String> {
    let document = validate_local_path(&path)?;
    if expected.is_none() && document.exists() {
        return Err("The destination appeared before saving. Choose Save as again.".into());
    }
    let written = write_assets(&document, assets)?;
    match save_document(path, source, expected, bom, line_ending) {
        Ok(revision) => Ok(revision),
        Err(error) => {
            rollback(&written);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn export_zip(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let path = validate_local_path(&path)?;
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        || !bytes.starts_with(b"PK\x03\x04")
        || bytes.len() > 320 * 1024 * 1024
    {
        return Err("Invalid ZIP export or export exceeds 320 MiB".into());
    }
    write_atomic(&path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (PathBuf, PathBuf, Vec<u8>) {
        let root = std::env::temp_dir().join(format!("markit-resource-test-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("docs")).unwrap();
        let doc = root.join("docs/note.md");
        fs::write(&doc, b"original").unwrap();
        let mut image = Vec::new();
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut Cursor::new(&mut image), image::ImageFormat::Png)
            .unwrap();
        (root, doc, image)
    }
    #[test]
    fn shared_images_require_a_project_or_explicit_folder() {
        let (root, doc, bytes) = setup();
        fs::create_dir(root.join("assets")).unwrap();
        fs::write(root.join("assets/中文 #%.png"), bytes).unwrap();
        assert!(resolve_asset(&doc, "../assets/中文 #%.png", &[]).is_err());
        assert!(resolve_asset(
            &doc,
            "../assets/中文 #%.png",
            &[root.to_string_lossy().into_owned()]
        )
        .is_ok());
        assert!(resolve_asset(
            &doc,
            "../assets/中文 #%.png",
            &[root.join("assets").to_string_lossy().into_owned()]
        )
        .is_ok());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_batch_leaves_no_images_and_uses_detected_format() {
        let (root, doc, bytes) = setup();
        assert!(import(
            &doc,
            "note.assets",
            vec![
                ImageInput {
                    name: "good.jpg".into(),
                    bytes: bytes.clone()
                },
                ImageInput {
                    name: "bad.png".into(),
                    bytes: vec![1, 2]
                }
            ]
        )
        .is_err());
        assert!(!root.join("docs/note.assets").exists());
        let paths = import(
            &doc,
            "note.assets",
            vec![ImageInput {
                name: "good.jpg".into(),
                bytes,
            }],
        )
        .unwrap();
        assert!(paths[0].ends_with(".png"));
        assert!(root.join("docs").join(&paths[0]).is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn copy_failure_rolls_back_and_never_overwrites_an_attachment() {
        let (root, doc, bytes) = setup();
        let assets = || {
            vec![AssetFile {
                relative_path: "copy.assets/a.png".into(),
                bytes: bytes.clone(),
            }]
        };
        assert!(save_document_copy(
            doc.to_string_lossy().into_owned(),
            "new".into(),
            assets(),
            Some(FileRevision {
                hash: "stale".into(),
                size: 0,
                modified_ms: 0
            }),
            false,
            "LF".into()
        )
        .is_err());
        assert!(!root.join("docs/copy.assets/a.png").exists());
        assert_eq!(fs::read_to_string(&doc).unwrap(), "original");
        write_assets(&doc, assets()).unwrap();
        assert!(write_assets(&doc, assets()).is_err());
        assert_eq!(
            fs::read(root.join("docs/copy.assets/a.png")).unwrap(),
            bytes
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn saved_copy_keeps_images_when_the_folder_moves() {
        let (root, original, bytes) = setup();
        let copy_folder = root.join("copy");
        fs::create_dir(&copy_folder).unwrap();
        let copy = copy_folder.join("copy.md");
        save_document_copy(
            copy.to_string_lossy().into_owned(),
            "![image](copy.assets/a.png)\n".into(),
            vec![AssetFile {
                relative_path: "copy.assets/a.png".into(),
                bytes: bytes.clone(),
            }],
            None,
            true,
            "CRLF".into(),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(original).unwrap(), "original");
        let moved = root.join("moved");
        fs::rename(copy_folder, &moved).unwrap();
        let restored = read_document(moved.join("copy.md").to_string_lossy().into_owned()).unwrap();
        assert!(restored.bom);
        assert_eq!(restored.line_ending, "CRLF");
        let image = read_image(
            moved.join("copy.md").to_string_lossy().into_owned(),
            "copy.assets/a.png".into(),
            None,
        )
        .unwrap();
        assert_eq!(image.bytes, bytes);
        assert!(
            optional_file_revision(moved.join("missing.md").to_string_lossy().into_owned())
                .unwrap()
                .is_none()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape_the_allowed_image_scope() {
        let (root, doc, bytes) = setup();
        fs::write(root.join("outside.png"), bytes.clone()).unwrap();
        std::os::unix::fs::symlink(root.join("outside.png"), root.join("docs/link.png")).unwrap();
        assert!(resolve_asset(&doc, "link.png", &[]).is_err());
        std::os::unix::fs::symlink(&root, root.join("docs/note.assets")).unwrap();
        assert!(import(
            &doc,
            "note.assets",
            vec![ImageInput {
                name: "a.png".into(),
                bytes
            }]
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
