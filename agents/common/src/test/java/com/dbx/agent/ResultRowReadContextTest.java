package com.dbx.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Proxy;
import java.nio.charset.MalformedInputException;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class ResultRowReadContextTest {
    private JsonArray keys() {
        JsonArray keys = new JsonArray();
        keys.add("TRN_DATE"); keys.add("JRNL_NO");
        return keys;
    }

    private ResultSet rows(Object[][] rows, int failureRow, int failureColumn, boolean failNext, List<Integer> reads) {
        String[] labels = {"ADDR", "TRN_DATE", "JRNL_NO"};
        ResultSetMetaData meta = (ResultSetMetaData) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{ResultSetMetaData.class}, (proxy, method, args) -> switch (method.getName()) {
            case "getColumnCount" -> labels.length;
            case "getColumnLabel" -> labels[(Integer) args[0] - 1];
            case "getColumnType" -> Types.VARCHAR;
            case "getColumnTypeName" -> "VARCHAR";
            default -> null;
        });
        AtomicInteger row = new AtomicInteger(-1);
        return (ResultSet) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{ResultSet.class}, (proxy, method, args) -> {
            if (method.getName().equals("getMetaData")) return meta;
            if (method.getName().equals("next")) {
                int next = row.incrementAndGet();
                if (failNext && next == failureRow) throw conversion();
                return next < rows.length;
            }
            if (method.getName().equals("getObject")) {
                int column = (Integer) args[0];
                reads.add(column);
                if (row.get() == failureRow && column == failureColumn) throw conversion();
                return rows[row.get()][column - 1];
            }
            return null;
        });
    }

    private SQLException conversion() { return new SQLException("conversion failed", null, -4220, new MalformedInputException(1)); }

    private JsonObject error(ResultSet rs) {
        RuntimeException failure = assertThrows(RuntimeException.class, () -> new JdbcExecutor().readResultSet(rs, 0, 100, (result, index, type) -> result.getObject(index)));
        return AgentRpcError.toJson(failure, AgentProtocol.METHOD_EXECUTE_QUERY, "session");
    }

    @Test void capturesCompositeKeysBeforeAnEarlierBrokenColumn() {
        List<Integer> reads = new ArrayList<>();
        try (var context = ResultRowReadContext.open(keys())) {
            JsonObject error = error(rows(new Object[][]{{"broken", "20261015", "0000123"}}, 0, 1, false, reads));
            JsonObject conversion = error.getAsJsonObject("data").getAsJsonObject("conversion");
            assertEquals(List.of(2, 3, 1), reads);
            assertEquals(1, conversion.get("rowIndex").getAsInt());
            assertEquals("0000123", conversion.getAsJsonObject("keyValues").get("JRNL_NO").getAsString());
            assertEquals(2, conversion.getAsJsonObject("keyValues").size());
            assertTrue(conversion.get("keysComplete").getAsBoolean());
            assertEquals("ADDR", conversion.get("columnName").getAsString());
            assertTrue(error.get("message").getAsString().contains("0000123"));
            assertEquals(-4220, error.getAsJsonObject("data").get("vendorCode").getAsInt());
        }
    }

    @Test void capturesTheFailingRowRatherThanThePreviousRow() {
        try (var context = ResultRowReadContext.open(keys())) {
            JsonObject conversion = error(rows(new Object[][]{{"ok", "20261015", "first-row"}, {"broken", "20261016", "failing-row"}}, 1, 1, false, new ArrayList<>())).getAsJsonObject("data").getAsJsonObject("conversion");
            assertEquals(2, conversion.get("rowIndex").getAsInt());
            assertEquals("failing-row", conversion.getAsJsonObject("keyValues").get("JRNL_NO").getAsString());
            assertFalse(conversion.toString().contains("first-row"));
        }
    }

    @Test void cursorAdvanceFailureNeverUsesPreviousRowKeys() {
        try (var context = ResultRowReadContext.open(keys())) {
            JsonObject error = error(rows(new Object[][]{{"ok", "20261015", "first-row"}, {"bad", "20261016", "second"}}, 1, 1, true, new ArrayList<>()));
            JsonObject conversion = error.getAsJsonObject("data").getAsJsonObject("conversion");
            assertFalse(conversion.has("keyValues"));
            assertFalse(error.toString().contains("first-row"));
            assertTrue(error.get("message").getAsString().contains("match keys unavailable"));
        }
    }

    @Test void anUnreadableKeyIsReportedAsIncomplete() {
        try (var context = ResultRowReadContext.open(keys())) {
            JsonObject conversion = error(rows(new Object[][]{{"bad", "20261015", "unreadable"}}, 0, 3, false, new ArrayList<>())).getAsJsonObject("data").getAsJsonObject("conversion");
            assertFalse(conversion.get("keysComplete").getAsBoolean());
            assertEquals("20261015", conversion.getAsJsonObject("keyValues").get("TRN_DATE").getAsString());
            assertFalse(conversion.getAsJsonObject("keyValues").has("JRNL_NO"));
        }
    }

    @Test void longKeysAreOmittedRatherThanPresentedAsExactTruncatedValues() {
        try (var context = ResultRowReadContext.open(keys())) {
            JsonObject conversion = error(rows(new Object[][]{{"bad", "20261015", "x".repeat(300)}}, 0, 1, false, new ArrayList<>())).getAsJsonObject("data").getAsJsonObject("conversion");
            assertFalse(conversion.get("keysComplete").getAsBoolean());
            assertFalse(conversion.getAsJsonObject("keyValues").has("JRNL_NO"));
        }
    }

    @Test void closingTheScopeRemovesKeysFromLaterRequests() {
        try (var context = ResultRowReadContext.open(keys())) { assertNotNull(ResultRowReadContext.current()); }
        assertNull(ResultRowReadContext.current());
        JsonObject error = error(rows(new Object[][]{{"bad", "20261015", "not-requested"}}, 0, 1, false, new ArrayList<>()));
        assertFalse(error.toString().contains("not-requested"));
    }

    @Test void duplicateAliasesCannotBeClaimedAsExactKeyLocations() {
        try (var context = ResultRowReadContext.open(keys())) {
            assertArrayEquals(new int[]{0, -1}, context.indexes(List.of("TRN_DATE", "JRNL_NO", "JRNL_NO")));
        }
    }

    @Test void decodedNullKeysAreExplicitRatherThanMissing() {
        try (var context = ResultRowReadContext.open(keys())) {
            JsonObject conversion = error(rows(new Object[][]{{"bad", "20261015", null}}, 0, 1, false, new ArrayList<>())).getAsJsonObject("data").getAsJsonObject("conversion");
            assertTrue(conversion.getAsJsonObject("keyValues").get("JRNL_NO").isJsonNull());
            assertTrue(conversion.get("keysComplete").getAsBoolean());
        }
    }
}
