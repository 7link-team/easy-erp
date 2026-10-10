//! Decimal input and rounding use integers only; intermediates fit in i128.
use crate::error::{ApiError, Result};
pub const MAX_MONEY: i64 = 99_999_999_999_999;
pub fn display(cents: i64) -> String {
    let amount = cents.unsigned_abs();
    format!(
        "{}{}.{:02}",
        if cents < 0 { "-" } else { "" },
        amount / 100,
        amount % 100
    )
}
pub fn decimal(value: &str, places: u32) -> Result<i64> {
    let value = value.trim();
    let parts: Vec<_> = value.split('.').collect();
    if value.len() > 24
        || parts.len() > 2
        || parts[0].is_empty()
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(ApiError::bad("请输入非负数字，不支持算式或科学计数法。"));
    }
    let fraction = parts.get(1).copied().unwrap_or("").trim_end_matches('0');
    if fraction.len() > places as usize {
        return Err(ApiError::bad(format!("最多支持 {places} 位小数。")));
    }
    let whole = parts[0]
        .parse::<i64>()
        .map_err(|_| ApiError::bad("金额过大。"))?;
    let frac = if fraction.is_empty() {
        0
    } else {
        fraction.parse::<i64>().unwrap() * 10i64.pow(places - fraction.len() as u32)
    };
    whole
        .checked_mul(10i64.pow(places))
        .and_then(|v| v.checked_add(frac))
        .filter(|v| *v <= MAX_MONEY)
        .ok_or_else(|| ApiError::bad("金额过大。"))
}
pub fn rounded(value: i128, divisor: i128) -> Result<i64> {
    i64::try_from((value + divisor / 2) / divisor)
        .ok()
        .filter(|v| *v >= 0 && *v <= MAX_MONEY)
        .ok_or_else(|| ApiError::bad("金额超出支持范围。"))
}
pub fn line(quantity: i64, price: i64) -> Result<i64> {
    rounded(quantity as i128 * price as i128, 100_000)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_decimal_and_rounding() {
        assert_eq!(display(1), "0.01");
        assert_eq!(display(-1), "-0.01");
        assert_eq!(display(MAX_MONEY), "999999999999.99");
        assert_eq!(decimal("80.0000", 4).unwrap(), 800000);
        assert_eq!(line(20500, 1000000).unwrap(), 205000);
        assert_eq!(line(1000, 50).unwrap(), 1);
        for invalid in ["-1", "NaN", "1e3", "1,000", ".5", "1.", "1.00001"] {
            assert!(decimal(invalid, 4).is_err());
        }
        assert!(line(999999999999, MAX_MONEY).is_err());
    }
}
