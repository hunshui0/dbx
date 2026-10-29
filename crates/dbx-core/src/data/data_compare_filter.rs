use sqlparser::{dialect::GenericDialect, parser::Parser, tokenizer::Token};

/// Accept exactly one expression, not a WHERE keyword, statement or query clause.
/// Render the parsed expression so comments cannot swallow generated SQL suffixes.
pub(super) fn normalize_where_condition(value: Option<&str>) -> Result<String, String> {
    let input = value.unwrap_or_default().trim();
    if input.is_empty() {
        return Ok(String::new());
    }
    let error =
        |detail| format!("Invalid comparison search condition. Enter only the expression after WHERE: {detail}");
    let mut parser = Parser::new(&GenericDialect {}).try_with_sql(input).map_err(|e| error(e.to_string()))?;
    let expression = parser.parse_expr().map_err(|e| error(e.to_string()))?;
    if parser.peek_token().token != Token::EOF {
        return Err(error("extra SQL clauses or statements are not allowed".to_string()));
    }
    Ok(expression.to_string())
}

pub(super) fn combine_compare_filters(existing: &str, condition: &str) -> String {
    match (existing.is_empty(), condition.is_empty()) {
        (_, true) => existing.to_string(),
        (true, false) => format!("({condition})"),
        (false, false) => format!("({existing}) AND ({condition})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_predicates_and_keeps_literal_content() {
        for condition in [
            "STATUS = 'A' AND AMOUNT >= 10",
            "ID IN (1, 2) OR NAME IS NULL",
            "NAME = 'WHERE; --中文'",
            "EXISTS (SELECT 1 FROM FLAGS WHERE FLAGS.ID = ID)",
        ] {
            let normalized = normalize_where_condition(Some(condition)).unwrap();
            assert!(!normalized.is_empty());
            assert!(normalize_where_condition(Some(&normalized)).is_ok());
        }
        assert_eq!(normalize_where_condition(None).unwrap(), "");
        assert_eq!(normalize_where_condition(Some("  \n ")).unwrap(), "");
        assert_eq!(normalize_where_condition(Some("ID = 1 -- a comment")).unwrap(), "ID = 1");
    }

    #[test]
    fn rejects_statements_keywords_and_trailing_query_clauses() {
        for condition in [
            "WHERE ID = 1",
            "ID = 1; DELETE FROM USERS",
            "ID = 1;",
            "ID = 1 ORDER BY ID",
            "ID = 1 LIMIT 10",
            "ID = 1 UNION SELECT 2",
            "SELECT * FROM USERS",
            "ID =",
            "ID = 1 /* unfinished",
        ] {
            assert!(normalize_where_condition(Some(condition)).is_err(), "{condition}");
        }
    }

    #[test]
    fn combines_with_key_exclusions_without_changing_or_precedence() {
        assert_eq!(
            combine_compare_filters("ID IS NOT NULL", "STATE = 'A' OR STATE = 'B'"),
            "(ID IS NOT NULL) AND (STATE = 'A' OR STATE = 'B')"
        );
        assert_eq!(combine_compare_filters("ID IS NOT NULL", ""), "ID IS NOT NULL");
        assert_eq!(combine_compare_filters("", "ID > 10"), "(ID > 10)");
        assert_eq!(combine_compare_filters("", ""), "");
    }
}
