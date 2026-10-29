package com.dbx.agent;

import java.sql.ResultSet;
import java.sql.SQLException;
import com.google.gson.JsonObject;
import com.google.gson.JsonNull;
import com.google.gson.JsonPrimitive;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Adds result-column context without replacing the original driver exception. */
public final class ResultColumnReadException extends RuntimeException {
    final int columnIndex;
    final int jdbcType;
    final String columnName;
    Long rowIndex;
    JsonObject keyValues;
    boolean keysComplete;

    ResultColumnReadException withRowContext(long row, ResultRowReadContext context, Map<String, Object> values) {
        rowIndex = row;
        keyValues = new JsonObject();
        keysComplete = context != null && context.complete() && !context.keys().isEmpty();
        if (context == null) return this;
        for (String key : context.keys()) {
            if (!values.containsKey(key)) { keysComplete = false; continue; }
            Object value = values.get(key);
            if (value == null) keyValues.add(key, JsonNull.INSTANCE);
            else if (value instanceof String text && text.length() <= 256) keyValues.addProperty(key, text);
            else if (value instanceof Number number && number.toString().length() <= 256
                && !(number instanceof Double d && !Double.isFinite(d))
                && !(number instanceof Float f && !Float.isFinite(f))) keyValues.add(key, new JsonPrimitive(number));
            else if (value instanceof Boolean flag) keyValues.addProperty(key, flag);
            else { keysComplete = false; continue; }
            if (keyValues.toString().getBytes(StandardCharsets.UTF_8).length > 8192) {
                keyValues.remove(key);
                keysComplete = false;
            }
        }
        return this;
    }

    public ResultColumnReadException(ResultSet resultSet, int columnIndex, int jdbcType, Throwable cause) {
        super(cause.getMessage(), cause);
        this.columnIndex = columnIndex;
        this.jdbcType = jdbcType;
        String label = null;
        try {
            label = resultSet.getMetaData().getColumnLabel(columnIndex);
        } catch (SQLException | RuntimeException ignored) {
            // Metadata may also be unavailable after a conversion failure.
        }
        this.columnName = label;
    }
}
