use crate::AppSettings;
use aws_config::Region;
use aws_credential_types::Credentials;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;
use base64::{engine::general_purpose::STANDARD, Engine as _};

async fn create_client(settings: &AppSettings) -> Result<Client, String> {
    if settings.aws_access_key_id.is_empty() || settings.aws_secret_access_key.is_empty() {
        return Err("AWS credentials not configured. Open Settings to add your keys.".to_string());
    }

    if settings.s3_bucket.is_empty() {
        return Err("S3 bucket name not configured. Open Settings to set it.".to_string());
    }

    let credentials = Credentials::new(
        &settings.aws_access_key_id,
        &settings.aws_secret_access_key,
        None,
        None,
        "shotty",
    );

    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new(settings.aws_region.clone()))
        .credentials_provider(credentials)
        .load()
        .await;

    Ok(Client::new(&config))
}

pub async fn upload(
    settings: AppSettings,
    image_data: String,
    filename: String,
) -> Result<String, String> {
    let client = create_client(&settings).await?;

    let raw = image_data
        .trim_start_matches("data:image/png;base64,")
        .to_string();
    let data = STANDARD.decode(&raw).map_err(|e| e.to_string())?;

    let mut request = client
        .put_object()
        .bucket(&settings.s3_bucket)
        .key(&filename)
        .body(ByteStream::from(data))
        .content_type("image/png");

    if settings.make_public {
        request = request.acl(aws_sdk_s3::types::ObjectCannedAcl::PublicRead);
    }

    request.send().await.map_err(|e| e.to_string())?;

    let url = if !settings.custom_domain.is_empty() {
        let domain = settings.custom_domain.trim_end_matches('/');
        format!("{}/{}", domain, filename)
    } else {
        format!(
            "https://{}.s3.{}.amazonaws.com/{}",
            settings.s3_bucket, settings.aws_region, filename
        )
    };

    Ok(url)
}

pub async fn test_connection(settings: AppSettings) -> Result<String, String> {
    let client = create_client(&settings).await?;

    client
        .head_bucket()
        .bucket(&settings.s3_bucket)
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    Ok("Connection successful!".to_string())
}
