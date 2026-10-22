package com.dbx.agent;

import java.sql.ResultSet;
import java.sql.SQLException;

/** Adds result-column context without replacing the original driver exception. */
public final class ResultColumnReadException extends RuntimeException {
    final int columnIndex;
    final int jdbcType;
    final String columnName;

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
