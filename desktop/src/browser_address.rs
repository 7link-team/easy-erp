//! Restrict browser destinations to inventory links or configured project pages.
pub fn project_url_allowed(url: &url::Url) -> bool {
    let Ok(package) = serde_json::from_str::<serde_json::Value>(include_str!("../../package.json"))
    else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && [
            package["repository"]["url"].as_str(),
            package["homepage"].as_str(),
            package["bugs"]["url"].as_str(),
        ]
        .into_iter()
        .flatten()
        .any(|address| url.as_str() == address)
}

// Only a single sales print reference may accompany an authenticated browser link.
pub fn print_query_allowed(url: &url::Url) -> bool {
    if url.query().is_none() {
        return true;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    if pairs.len() != 1 || pairs[0].0 != "sale_print" {
        return false;
    }
    let value = pairs[0].1.as_bytes();
    value.len() == 36
        && value.iter().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                *b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_project_links_to_configured_https_pages() {
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        for address in [
            package["repository"]["url"].as_str().unwrap(),
            package["homepage"].as_str().unwrap(),
        ] {
            let url = url::Url::parse(address).unwrap();
            assert!(project_url_allowed(&url));
            for suffix in ["?next=other", "#fragment", "/other"] {
                assert!(!project_url_allowed(
                    &url::Url::parse(&format!("{address}{suffix}")).unwrap()
                ));
            }
            let mut insecure = url.clone();
            insecure.set_scheme("http").unwrap();
            assert!(!project_url_allowed(&insecure));
            let mut credentials = url.clone();
            credentials.set_username("user").unwrap();
            assert!(!project_url_allowed(&credentials));
            let mut other_host = url;
            other_host.set_host(Some("example.invalid")).unwrap();
            assert!(!project_url_allowed(&other_host));
        }
    }
    #[test]
    fn limits_browser_query_to_print_reference() {
        for query in ["", "?sale_print=12345678-1234-1234-1234-123456789abc"] {
            assert!(print_query_allowed(
                &url::Url::parse(&format!("http://localhost:4280/{query}")).unwrap()
            ));
        }
        for query in [
            "?",
            "?sale_print=bad",
            "?next=https://evil.example",
            "?sale_print=12345678-1234-1234-1234-123456789abc&next=x",
        ] {
            assert!(!print_query_allowed(
                &url::Url::parse(&format!("http://localhost:4280/{query}")).unwrap()
            ));
        }
    }
}
