//! Only a single sales print reference may accompany an authenticated browser link.
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
