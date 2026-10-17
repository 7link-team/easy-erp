//! MySQL dialect for the application's parameterized SQL. Values remain bound.
use regex::{Captures, Regex};
use std::sync::LazyLock;

static JSON_EXTRACT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)json_extract\(([\w.]+),\s*'([^']+)'\)").unwrap());
static UPSERT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)ON CONFLICT\([^)]*\) DO UPDATE SET").unwrap());
static IGNORE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)ON CONFLICT\([^)]*\) DO NOTHING").unwrap());
static EXCLUDED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"excluded\.(\w+)").unwrap());
static INDEXED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r" INDEXED BY \w+").unwrap());
static TEXT_COLUMN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\w+) TEXT").unwrap());

pub fn query(sql: &str) -> String {
    let mut sql = sql
        .replace(",json_each(", " CROSS JOIN json_each(")
        .replace(r"ESCAPE '\'", r"ESCAPE '\\'")
        .replace("c.account_id,c.account_name,MAX(c.created_at)", "c.account_id,ANY_VALUE(c.account_name) AS account_name,MAX(c.created_at)")
        .replace("customer_name AS name1", "ANY_VALUE(customer_name) AS name1")
        .replace(",department_name,salesperson_name,COUNT", ",ANY_VALUE(department_name),ANY_VALUE(salesperson_name),COUNT")
        .replace(",department_name,salesperson_name,0", ",ANY_VALUE(department_name),ANY_VALUE(salesperson_name),0")
        .replace("salesperson_id,department_name,salesperson_name,SUM", "salesperson_id,ANY_VALUE(department_name) AS department_name,ANY_VALUE(salesperson_name) AS salesperson_name,SUM")
        .replace("json_extract(s.data,'$.type_name') AS type_name", "ANY_VALUE(json_extract(s.data,'$.type_name')) AS type_name")
        .replace("HAVING COUNT(*)>1)", "HAVING COUNT(*)>1) AS duplicate_rows")
        .replace("HAVING COUNT(*)>2)", "HAVING COUNT(*)>2) AS duplicate_rows")
        .replace(" AS MATERIALIZED", " AS")
        .replace("MAX(c.amount,0)", "GREATEST(c.amount,0)")
        .replace("MAX(-c.amount,0)", "GREATEST(-c.amount,0)")
        .replace(
            "'worker-' || CAST(can_in AS TEXT) || CAST(can_out AS TEXT) || CAST(can_count AS TEXT)",
            "CONCAT('worker-',can_in,can_out,can_count)",
        );
    sql = INDEXED.replace_all(&sql, "").into_owned();
    // json_each is only used to expand immutable JSON arrays in reporting queries.
    while let Some(start) = sql.find("json_each(") {
        let args_start = start + "json_each(".len();
        let mut depth = 1;
        let mut quoted = false;
        let mut end = args_start;
        let mut comma = None;
        for (offset, character) in sql[args_start..].char_indices() {
            if character == '\'' {
                quoted = !quoted;
            }
            if !quoted {
                match character {
                    '(' => depth += 1,
                    ')' => depth -= 1,
                    ',' if depth == 1 => comma = Some(args_start + offset),
                    _ => (),
                }
            }
            if depth == 0 {
                end = args_start + offset;
                break;
            }
        }
        let (expr, path) = match comma {
            Some(comma) => (
                &sql[args_start..comma],
                sql[comma + 1..end].trim().trim_matches('\''),
            ),
            None => (&sql[args_start..end], "$"),
        };
        let replacement = format!("JSON_TABLE({expr},'{path}[*]' COLUMNS(value JSON PATH '$'))");
        sql.replace_range(start..=end, &replacement);
    }
    sql = JSON_EXTRACT
        .replace_all(&sql, |caps: &Captures| {
            let expression = format!("JSON_UNQUOTE(JSON_EXTRACT({},'{}'))", &caps[1], &caps[2]);
            let field = caps[2].rsplit('.').next().unwrap();
            if field == "billable" {
                format!("(CASE {expression} WHEN 'true' THEN 1 WHEN 'false' THEN 0 ELSE NULL END)")
            } else if [
                "credit",
                "total",
                "sort",
                "allocated",
                "quantity",
                "amount",
                "price",
            ]
            .contains(&field)
            {
                format!("CAST({expression} AS SIGNED)")
            } else {
                format!("NULLIF({expression},'null')")
            }
        })
        .into_owned();
    sql = sql.replace("ref.value", "JSON_UNQUOTE(ref.value)");
    sql = UPSERT
        .replace_all(&sql, "ON DUPLICATE KEY UPDATE")
        .into_owned();
    sql = IGNORE
        .replace_all(&sql, "ON DUPLICATE KEY UPDATE id=id")
        .into_owned();
    sql = EXCLUDED.replace_all(&sql, "VALUES($1)").into_owned();
    quote_identifiers(&sql)
}

// These existing column names are reserved by MySQL. Skip all string literals.
fn quote_identifiers(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let mut token = String::new();
    let mut delimiter = None;
    let flush = |result: &mut String, token: &mut String| {
        if ["key", "precision"].contains(&token.as_str()) {
            result.push('`');
            result.push_str(token);
            result.push('`');
        } else {
            result.push_str(token);
        }
        token.clear();
    };
    for character in sql.chars() {
        if let Some(quote) = delimiter {
            result.push(character);
            if character == quote {
                delimiter = None;
            }
        } else if character == '\'' || character == '`' {
            flush(&mut result, &mut token);
            delimiter = Some(character);
            result.push(character);
        } else if character.is_ascii_alphanumeric() || character == '_' {
            token.push(character);
        } else {
            flush(&mut result, &mut token);
            result.push(character);
        }
    }
    flush(&mut result, &mut token);
    result
}

pub fn schema(sql: &str) -> String {
    if sql.starts_with("CREATE UNIQUE INDEX sales_catalog_name") {
        return "CREATE UNIQUE INDEX sales_catalog_name ON sales_catalog(kind,name,(CAST(CASE WHEN kind='salesperson' THEN JSON_UNQUOTE(JSON_EXTRACT(data,'$.department_id')) ELSE '' END AS CHAR(128))))".into();
    }
    if sql.starts_with("CREATE INDEX sales_business_date") {
        return "CREATE INDEX sales_business_date ON sales((CAST(JSON_UNQUOTE(JSON_EXTRACT(data,'$.business_date')) AS CHAR(10))),created_at DESC,id ASC)".into();
    }
    // The general ordered/status indexes cover these reads on MySQL. SQLite's
    // covering expression index exceeds MySQL's key-size limit.
    if sql.starts_with("CREATE INDEX sales_reporting") {
        return "SELECT 1".into();
    }
    let sql = TEXT_COLUMN
        .replace_all(sql, |caps: &Captures| {
            let name = &caps[1];
            let kind = if ["data", "permissions"].contains(&name) {
                "LONGTEXT"
            } else if name == "id" || name.ends_with("_id") {
                "VARCHAR(128)"
            } else if name == "business_date" {
                "VARCHAR(10)"
            } else {
                "VARCHAR(255)"
            };
            format!("{name} {kind}")
        })
        .replace("data BLOB", "data LONGBLOB")
        .replace(" INTEGER", " BIGINT")
        .replace(
            "INSERT INTO sales_catalog VALUES",
            "INSERT IGNORE INTO sales_catalog VALUES",
        );
    let sql = query(&sql);
    if sql.starts_with("CREATE TABLE ") {
        format!("{sql} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
    } else {
        sql
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn preserves_literals_and_bound_values() {
        let sql = super::query("UPDATE items SET precision=? WHERE code='precision' AND id=?");
        assert_eq!(
            sql,
            "UPDATE items SET `precision`=? WHERE code='precision' AND id=?"
        );
    }
    #[test]
    fn json_scalars_keep_sqlite_types() {
        let sql = super::query(
            "SELECT json_extract(data,'$.billable'),json_extract(data,'$.total'),json_extract(data,'$.customer.name') FROM sales",
        );
        assert!(sql.contains("WHEN 'true' THEN 1"));
        assert!(sql.contains("AS SIGNED"));
        assert!(sql.contains("NULLIF(JSON_UNQUOTE"));
    }
}
