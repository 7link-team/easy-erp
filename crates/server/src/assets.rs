use axum::{
    body::Body,
    extract::Request,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "$CARGO_MANIFEST_DIR/../../dist"]
struct WebAssets;

pub async fn serve(request: Request) -> Response {
    let path = request.uri().path().trim_start_matches('/');
    if path.starts_with("api/") {
        return (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error":"接口不存在。"})),
        )
            .into_response();
    }
    let name = if path.is_empty() { "index.html" } else { path };
    let Some((asset, asset_name)) = WebAssets::get(name).map(|asset| (asset, name)).or_else(|| {
        if !name.contains('.') {
            WebAssets::get("index.html").map(|asset| (asset, "index.html"))
        } else {
            None
        }
    }) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let content_type = mime_guess::from_path(asset_name)
        .first_or_octet_stream()
        .to_string();
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(asset.data.into_owned()))
        .unwrap()
}
