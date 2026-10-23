package com.dbx.agent;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Types;
import java.lang.reflect.Proxy;
import java.nio.charset.MalformedInputException;
import java.util.concurrent.CancellationException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentRpcErrorTest {
    @Test
    void conversionFailureKeepsSqlClassificationAndBoundedColumnDiagnostics() {
        ResultSetMetaData meta = (ResultSetMetaData) Proxy.newProxyInstance(getClass().getClassLoader(),
            new Class<?>[] {ResultSetMetaData.class}, (proxy, method, args) ->
                "getColumnLabel".equals(method.getName()) ? "客户姓名" : null);
        ResultSet rs = (ResultSet) Proxy.newProxyInstance(getClass().getClassLoader(),
            new Class<?>[] {ResultSet.class}, (proxy, method, args) ->
                "getMetaData".equals(method.getName()) ? meta : null);
        SQLException original = new SQLException("conversion failed", null, -4220, new MalformedInputException(2));
        var error = new ResultColumnReadException(rs, 3, Types.VARCHAR, original);
        JsonObject data = errorData(error, AgentProtocol.METHOD_EXECUTE_QUERY, "session-1");
        assertEquals("sql", data.get("category").getAsString());
        assertEquals(-4220, data.get("vendorCode").getAsInt());
        assertEquals(SQLException.class.getName(), data.get("exceptionClass").getAsString());
        assertEquals("keep", data.get("sessionDisposition").getAsString());
        assertFalse(data.get("retryable").getAsBoolean());
        var diagnostic = data.getAsJsonObject("conversion");
        assertEquals(3, diagnostic.get("columnIndex").getAsInt());
        assertEquals("客户姓名", diagnostic.get("columnName").getAsString());
        assertEquals(Types.VARCHAR, diagnostic.get("jdbcType").getAsInt());
        assertEquals(2, diagnostic.get("inputLength").getAsInt());
        assertTrue(diagnostic.getAsJsonArray("causeClasses").toString().contains("MalformedInputException"));
        String visible = AgentRpcError.toJson(error, AgentProtocol.METHOD_EXECUTE_QUERY, "session-1")
            .get("message").getAsString();
        assertTrue(visible.startsWith("conversion failed"));
        assertTrue(visible.contains("column 3 (客户姓名)"));
        assertTrue(visible.contains("MalformedInputException"));
        assertTrue(visible.contains("exclude the affected column for this table"));
        assertTrue(visible.contains("not replaced or treated as NULL"));
    }

    @Test
    void conversionDiagnosticTraversalIsBoundedAndHandlesSqlNextExceptionCycles() {
        SQLException head = new SQLException("conversion failed", null, -4220);
        SQLException tail = head;
        for (int i = 0; i < 30; i++) {
            SQLException next = new SQLException("details");
            tail.initCause(next);
            tail = next;
        }
        var conversion = errorData(head, AgentProtocol.METHOD_EXECUTE_QUERY, null).getAsJsonObject("conversion");
        assertEquals(16, conversion.getAsJsonArray("causeClasses").size());
        SQLException cycle = new SQLException("conversion failed", null, -4220);
        cycle.setNextException(cycle);
        assertEquals(1, errorData(cycle, AgentProtocol.METHOD_EXECUTE_QUERY, null)
            .getAsJsonObject("conversion").getAsJsonArray("causeClasses").size());
        assertFalse(errorData(new SQLException("ordinary failure"), AgentProtocol.METHOD_EXECUTE_QUERY, null)
            .has("conversion"));
    }

    @Test
    void serializesVersionedSqlDiagnosticsAndUnknownExecuteOutcome() {
        SQLException cause = new SQLException("statement failed", "42000", 1064);

        JsonObject data = errorData(cause, AgentProtocol.METHOD_EXECUTE_QUERY, "session-1");

        assertEquals(1, data.get("contractVersion").getAsInt());
        assertEquals("sql", data.get("category").getAsString());
        assertEquals("execute", data.get("stage").getAsString());
        assertEquals("unknown", data.get("operationOutcome").getAsString());
        assertEquals("keep", data.get("sessionDisposition").getAsString());
        assertEquals("42000", data.get("sqlState").getAsString());
        assertEquals(1064, data.get("vendorCode").getAsInt());
        assertEquals(SQLException.class.getName(), data.get("exceptionClass").getAsString());
        assertEquals("session-1", data.get("agentSessionId").getAsString());
    }

    @Test
    void classifiesTimeoutAndCanceledErrorsWithoutClaimingSafeReplay() {
        JsonObject timeout = errorData(
            new SQLTimeoutException("timed out", "HYT00", 0),
            AgentProtocol.METHOD_EXECUTE_QUERY,
            "session-1"
        );
        JsonObject canceled = errorData(
            new CancellationException("canceled"),
            AgentProtocol.METHOD_CANCEL_SESSION,
            "session-1"
        );

        assertEquals("timeout", timeout.get("category").getAsString());
        assertEquals("unknown", timeout.get("operationOutcome").getAsString());
        assertFalse(timeout.get("retryable").getAsBoolean());
        assertEquals("quarantine", timeout.get("sessionDisposition").getAsString());
        assertEquals("canceled", canceled.get("category").getAsString());
        assertEquals("cancel", canceled.get("stage").getAsString());
        assertEquals("unknown", canceled.get("operationOutcome").getAsString());
    }

    @Test
    void marksConnectionSetupFailureAsNotStartedAndBoundsSqlState() {
        SQLException cause = new SQLException("connect failed", "12345678901234567890", -7);

        JsonObject data = errorData(cause, AgentProtocol.METHOD_CONNECT, null);

        assertEquals("connection", data.get("category").getAsString());
        assertEquals("connect", data.get("stage").getAsString());
        assertEquals("not_started", data.get("operationOutcome").getAsString());
        assertEquals(16, data.get("sqlState").getAsString().length());
        assertFalse(data.has("agentSessionId"));
    }

    @Test
    void removesNonGraphicCharactersFromStrictDiagnostics() {
        SQLException cause = new SQLException("connect failed", "08\n006\u00e9", -7);

        JsonObject data = errorData(cause, AgentProtocol.METHOD_CONNECT, null);

        assertEquals("08006", data.get("sqlState").getAsString());
    }

    @Test
    void mapsConnectionAndCloseMethodsToTheSameStagesAsTheRustDecoder() {
        JsonObject testConnection = errorData(
            new SQLException("connect failed", "08001", 0),
            AgentProtocol.METHOD_TEST_CONNECTION,
            null
        );
        JsonObject closeQuery = errorData(
            new SQLException("close failed", "42000", 0),
            AgentProtocol.METHOD_CLOSE_QUERY_SESSION,
            "session-1"
        );

        assertEquals("connect", testConnection.get("stage").getAsString());
        assertEquals("not_started", testConnection.get("operationOutcome").getAsString());
        assertEquals("close", closeQuery.get("stage").getAsString());
        assertEquals("unknown", closeQuery.get("operationOutcome").getAsString());
    }

    private static JsonObject errorData(Throwable error, String method, String agentSessionId) {
        return AgentRpcError.toJson(error, method, agentSessionId).getAsJsonObject("data");
    }
}
