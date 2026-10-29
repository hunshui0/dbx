package com.dbx.agent;

import com.google.gson.JsonElement;
import java.util.ArrayList;
import java.util.List;

/** Request-scoped locator column names; row values are never kept in thread-local state. */
public final class ResultRowReadContext implements AutoCloseable {
    private static final ThreadLocal<ResultRowReadContext> CURRENT = new ThreadLocal<>();
    private final ResultRowReadContext previous;
    private final List<String> keys = new ArrayList<>();
    private boolean complete = true;
    private List<String> cachedColumns;
    private int[] cachedIndexes;

    public static ResultRowReadContext open(JsonElement requested) {
        return new ResultRowReadContext(requested);
    }

    private ResultRowReadContext(JsonElement requested) {
        previous = CURRENT.get();
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
