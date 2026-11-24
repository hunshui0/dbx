package com.dbx.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Request-scoped locator column names; row values are never kept in thread-local state. */
public final class ResultRowReadContext implements AutoCloseable {
    static final String ENCODING_ERROR_CODE = "DBX_ENCODING_ERROR";
    static final String ENCODING_ERROR_OVERFLOW_CODE = "DBX_ENCODING_ERROR_OVERFLOW";
    private static final int MAX_DETAILED_ENCODING_ERRORS = 500;

    private static final ThreadLocal<ResultRowReadContext> CURRENT = new ThreadLocal<>();
    private final ResultRowReadContext previous;
    private final List<String> keys = new ArrayList<>();
    private final boolean tolerateEncodingErrors;
    private boolean complete = true;
    private List<String> cachedColumns;
    private int[] cachedIndexes;
    private List<Map<String, Object>> encodingErrorMessages;
    private List<int[]> overflowCells;
    private int totalEncodingErrors;

    public static ResultRowReadContext open(JsonElement requested) {
        return new ResultRowReadContext(requested, false);
    }

    public static ResultRowReadContext open(JsonElement requested, boolean tolerateEncodingErrors) {
        return new ResultRowReadContext(requested, tolerateEncodingErrors);
    }

    private ResultRowReadContext(JsonElement requested, boolean tolerateEncodingErrors) {
        this.previous = CURRENT.get();
        this.tolerateEncodingErrors = tolerateEncodingErrors;
        if (requested != null && requested.isJsonArray()) {
            complete = requested.getAsJsonArray().size() <= 32;
            for (JsonElement item : requested.getAsJsonArray()) {
                if (keys.size() == 32) break;
                if (!item.isJsonPrimitive() || !item.getAsJsonPrimitive().isString()) { complete = false; continue; }
                String name = item.getAsString();
                if (name.isEmpty() || name.length() > 128) { complete = false; continue; }
                if (!keys.contains(name)) keys.add(name);
            }
        }
        CURRENT.set(this);
    }

    static ResultRowReadContext current() { return CURRENT.get(); }
    List<String> keys() { return keys; }
    boolean complete() { return complete; }
    boolean tolerateEncodingErrors() { return tolerateEncodingErrors; }

    void recordEncodingError(
        int rowIndex,
        int columnIndex,
        String columnName,
        int jdbcType,
        boolean isKeyColumn,
        Map<String, Object> rowKeys,
        Throwable error
    ) {
        totalEncodingErrors++;
        if (encodingErrorMessages == null) encodingErrorMessages = new ArrayList<>();
        if (encodingErrorMessages.size() < MAX_DETAILED_ENCODING_ERRORS) {
            JsonObject keyValues = new JsonObject();
            boolean keysComplete = complete && !keys.isEmpty();
            for (String key : keys) {
                if (!rowKeys.containsKey(key)) { keysComplete = false; continue; }
                Object value = rowKeys.get(key);
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
            JsonObject detail = new JsonObject();
            detail.addProperty("rowIndex", rowIndex);
            detail.addProperty("columnIndex", columnIndex);
            if (columnName != null && !columnName.isBlank()) {
                detail.addProperty("columnName", columnName.substring(0, Math.min(128, columnName.length())));
            }
            detail.addProperty("jdbcType", jdbcType);
            detail.addProperty("isKeyColumn", isKeyColumn);
            detail.add("keyValues", keyValues);
            detail.addProperty("keysComplete", keysComplete);

            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("severity", "WARNING");
            entry.put("code", ENCODING_ERROR_CODE);
            entry.put("message", AgentRpcError.conversionShortMessage(error));
            entry.put("detail", detail.toString());
            encodingErrorMessages.add(entry);
        } else {
            if (overflowCells == null) overflowCells = new ArrayList<>();
            overflowCells.add(new int[]{rowIndex, columnIndex, isKeyColumn ? 1 : 0});
        }
    }

    List<Map<String, Object>> drainEncodingErrorMessages() {
        if (totalEncodingErrors == 0) return Collections.emptyList();
        List<Map<String, Object>> result = new ArrayList<>(encodingErrorMessages);
        if (overflowCells != null && !overflowCells.isEmpty()) {
            JsonObject detail = new JsonObject();
            detail.addProperty("totalCount", totalEncodingErrors);
            JsonArray cells = new JsonArray();
            for (int[] cell : overflowCells) {
                JsonArray item = new JsonArray();
                item.add(cell[0]);
                item.add(cell[1]);
                item.add(cell[2] == 1);
                cells.add(item);
            }
            detail.add("cells", cells);
            Map<String, Object> overflow = new LinkedHashMap<>();
            overflow.put("severity", "WARNING");
            overflow.put("code", ENCODING_ERROR_OVERFLOW_CODE);
            overflow.put("message", "Additional character encoding errors omitted from detailed list");
            overflow.put("detail", detail.toString());
            result.add(overflow);
        }
        encodingErrorMessages = null;
        overflowCells = null;
        totalEncodingErrors = 0;
        return result;
    }

    int[] indexes(List<String> columns) {
        if (cachedColumns == columns) return cachedIndexes;
        cachedColumns = columns;
        cachedIndexes = new int[keys.size()];
        for (int k = 0; k < keys.size(); k++) {
            String key = keys.get(k);
            int index = columns.indexOf(key);
            if (index >= 0 && columns.lastIndexOf(key) != index) { cachedIndexes[k] = -1; continue; }
            if (index < 0) {
                int matches = 0;
                for (int i = 0; i < columns.size(); i++) {
                    if (key.equalsIgnoreCase(columns.get(i))) { index = i; matches++; }
                }
                if (matches != 1) index = -1;
            }
            cachedIndexes[k] = index;
        }
        return cachedIndexes;
    }

    @Override
    public void close() {
        if (previous == null) CURRENT.remove(); else CURRENT.set(previous);
    }
}
