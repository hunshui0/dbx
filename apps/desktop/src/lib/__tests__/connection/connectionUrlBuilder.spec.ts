import { describe, expect, it } from "vitest";
import { buildConnectionUrlCopy, connectionSupportsUrlCopy, connectionUrlCopyFormats, type ConnectionUrlCopyConfig } from "@/lib/connection/connectionUrlBuilder";

function config(overrides: Partial<ConnectionUrlCopyConfig> = {}): ConnectionUrlCopyConfig {
  return { db_type: "postgres", host: "db.example.com", port: 5432, username: "app_user", password: "secret", database: "appdb", url_params: "", ssl: false, ...overrides };
}

const removedFormats = ["password", "urlWithPassword", "jdbcUrlWithCredentials", "dsnWithPassword"] as const;

describe("password-free connection copying", () => {
  const oceanbase = (overrides: Partial<ConnectionUrlCopyConfig> = {}) => config({ db_type: "mysql", driver_profile: "oceanbase", port: 2881, username: "admin@tenant@cluster", ...overrides });

  it.each(["secret", "", "p@ss%40中文🔑"])("offers only safe formats regardless of stored password %j", (password) => {
    expect(connectionUrlCopyFormats(config({ password }))).toEqual(["url", "jdbcUrl", "hostPort", "dsn", "psqlCommand"]);
  });

  it.each(removedFormats)("rejects removed %s actions even when invoked directly", (format) => {
    for (const connection of [config(), config({ connection_string: "postgresql://user:embedded-secret@db.example.com/app" }), config({ url_params: "password=query-secret" })]) {
      expect(buildConnectionUrlCopy(connection, format)).toBeNull();
      expect(connectionUrlCopyFormats(connection)).not.toContain(format);
    }
  });

  it.each(["postgres", "mysql", "db2", "oracle", "sqlserver", "redis", "elasticsearch", "hive", "teradata"] as const)("never copies a stored password in any offered %s format", (db_type) => {
    const password = "copy-forbidden@中文#%40";
    const connection = config({ db_type, password });
    const formats = connectionUrlCopyFormats(connection);
    expect(formats.length).toBeGreaterThan(0);
    for (const format of formats) {
      const text = buildConnectionUrlCopy(connection, format)!;
      expect(text).toBeTruthy();
      expect(text).not.toContain(password);
      expect(text).not.toContain(encodeURIComponent(password));
      expect(removedFormats).not.toContain(format);
    }
  });

  it("redacts credentials in host URLs in host:port and psql copies too", () => {
    const connection = config({ host: "postgresql://user:embedded-secret@db.example.com:5432/app?password=query-secret" });
    for (const format of connectionUrlCopyFormats(connection)) {
      const text = buildConnectionUrlCopy(connection, format)!;
      expect(text).not.toContain("embedded-secret");
      expect(text).not.toContain("query-secret");
    }
  });

  it("never offers query-only tokens as an unredacted copy", () => {
    const connection = config({ db_type: "elasticsearch", username: "", password: "", database: "", url_params: "token=query-secret&pretty" });
    expect(connectionUrlCopyFormats(connection)).toEqual(["url", "hostPort"]);
    expect(buildConnectionUrlCopy(connection, "url")).toContain("token=***&pretty");
  });

  it("keeps OceanBase tenant names readable without credentials", () => {
    expect(buildConnectionUrlCopy(oceanbase(), "url")).toBe("oceanbase://admin@tenant@cluster@db.example.com:2881/appdb");
    expect(buildConnectionUrlCopy(oceanbase(), "jdbcUrl")).toBe("jdbc:oceanbase://db.example.com:2881/appdb");
    expect(connectionUrlCopyFormats(oceanbase())).toEqual(["url", "jdbcUrl", "hostPort"]);
  });
  it("keeps safe punctuation readable without changing ordinary MySQL encoding", () => {
    const username = "u!$()*,=@tenant";
    expect(buildConnectionUrlCopy(oceanbase({ username }), "url")).toContain(username + "@");
    expect(buildConnectionUrlCopy(config({ db_type: "mysql", username }), "url")).toContain("u%21%24%28%29%2A%2C=%40tenant@");
  });

  it("preserves explicit strings while redacting passwords behind raw tenant names", () => {
    const explicit = "oceanbase://admin@tenant:synthetic%40secret@db.example.com:2881/appdb";
    expect(buildConnectionUrlCopy(oceanbase({ connection_string: explicit }), "url")).toBe("oceanbase://admin@tenant:***@db.example.com:2881/appdb");
    const jdbc = "jdbc:oceanbase://db.example.com:2881/appdb?user=literal%40tenant&password=secret";
    expect(buildConnectionUrlCopy(oceanbase({ connection_string: jdbc }), "jdbcUrl")).toBe("jdbc:oceanbase://db.example.com:2881/appdb?user=literal%40tenant&password=***");
  });

  it("hides everything for file-based connections", () => {
    expect(connectionSupportsUrlCopy(config({ db_type: "sqlite", host: "/data/app.db", port: 0 }))).toBe(false);
    expect(connectionUrlCopyFormats(config({ db_type: "duckdb", host: "/data/app.duckdb", port: 0 }))).toEqual([]);
    expect(connectionUrlCopyFormats(config({ db_type: "h2", host: "/data/app.mv.db", port: 0 }))).toEqual([]);
  });

  it("keeps H2 server mode available through its explicit connection string", () => {
    const formats = connectionUrlCopyFormats(config({ db_type: "h2", host: "db.example.com", port: 9092, connection_string: "jdbc:h2:tcp://db.example.com:9092/~/test" }));
    expect(formats).toEqual(["url", "hostPort"]);
  });

  it("hides URL copy for service-registry and message-queue connections", () => {
    expect(connectionUrlCopyFormats(config({ db_type: "nacos", host: "nacos.example.com", port: 8848 }))).toEqual([]);
    expect(connectionUrlCopyFormats(config({ db_type: "mq", host: "kafka.example.com", port: 9092 }))).toEqual([]);
  });

  it("offers only JDBC formats for hive-family connections", () => {
    const formats = connectionUrlCopyFormats(config({ db_type: "hive", host: "hive.example.com", port: 10000, database: "dw" }));
    expect(formats).toEqual(["jdbcUrl", "hostPort"]);
  });

  it("uses semicolon options when copying an Inceptor JDBC URL", () => {
    const transwarp = config({ db_type: "transwarp", host: "quark.example.com", port: 10000, database: "default", username: "", password: "", url_params: "fetchSize=500" });
    expect(buildConnectionUrlCopy(transwarp, "jdbcUrl")).toBe("jdbc:inceptor2://quark.example.com:10000/default;fetchSize=500");
  });

  it("builds a password-free PostgreSQL URL for the primary item", () => {
    expect(buildConnectionUrlCopy(config({}), "url")).toBe("postgresql://app_user@db.example.com:5432/appdb");
  });

  it("appends url_params and adds sslmode when ssl is enabled", () => {
    expect(buildConnectionUrlCopy(config({ url_params: "application_name=svc" }), "url")).toBe("postgresql://app_user@db.example.com:5432/appdb?application_name=svc");
    expect(buildConnectionUrlCopy(config({ ssl: true, url_params: "application_name=svc" }), "url")).toBe("postgresql://app_user@db.example.com:5432/appdb?application_name=svc&sslmode=require");
    expect(buildConnectionUrlCopy(config({ ssl: true, url_params: "sslmode=verify-full" }), "url")).toBe("postgresql://app_user@db.example.com:5432/appdb?sslmode=verify-full");
  });

  it("honours the database override from a database tree node", () => {
    expect(buildConnectionUrlCopy(config({}), "url", { database: "reporting" })).toBe("postgresql://app_user@db.example.com:5432/reporting");
  });

  it("uses rediss:// when TLS is enabled for Redis", () => {
    const redis = config({ db_type: "redis", host: "cache.example.com", port: 6379, username: "", database: "0", ssl: true });
    expect(buildConnectionUrlCopy(redis, "url")).toBe("rediss://cache.example.com:6379/0");
  });

  it("falls back to db 0 for non-numeric Redis database values instead of percent-encoding them", () => {
    const redis = config({ db_type: "redis", host: "cache.example.com", port: 6379, username: "coupon", password: "", database: "0 --tls --insecure", url_params: "insecure=true", ssl: true });
    expect(buildConnectionUrlCopy(redis, "url")).toBe("rediss://coupon@cache.example.com:6379/0?insecure=true");
    expect(buildConnectionUrlCopy(config({ db_type: "redis", database: "3" }), "url")).toBe("redis://app_user@db.example.com:5432/3");
  });

  it("redacts explicit connection strings without offering a password variant", () => {
    const jdbcConfig = config({ db_type: "jdbc", host: "", port: 0, username: "", password: "", database: undefined, connection_string: "jdbc:dremio:direct=drill.example.com:31010;user=analyst;password=s3cret" });
    expect(buildConnectionUrlCopy(jdbcConfig, "url")).toBe("jdbc:dremio:direct=drill.example.com:31010;user=analyst;password=***");
    expect(connectionUrlCopyFormats(jdbcConfig)).toEqual(["url"]);
  });

  it("redacts an explicit URL with a password but no username", () => {
    const redis = config({ db_type: "redis", host: "cache.example.com", port: 6379, username: "", password: "", database: "0", connection_string: "redis://:synthetic-secret@cache.example.com:6379/0" });
    expect(buildConnectionUrlCopy(redis, "url")).toBe("redis://:***@cache.example.com:6379/0");
    expect(buildConnectionUrlCopy({ ...redis, connection_string: "redis://cache.example.com:6379/0" }, "url")).toBe("redis://cache.example.com:6379/0");
  });

  it("builds a generic PostgreSQL JDBC URL", () => {
    expect(buildConnectionUrlCopy(config({}), "jdbcUrl")).toBe("jdbc:postgresql://db.example.com:5432/appdb");
  });

  it("redacts a percent-encoded password property name accepted by the MySQL importer", () => {
    const mysql = config({ db_type: "mysql", port: 3306, username: "", password: "", url_params: "pass%77ord=synthetic-secret&connectTimeout=5000" });
    expect(buildConnectionUrlCopy(mysql, "url")).toContain("pass%77ord=***&connectTimeout=5000");
    expect(buildConnectionUrlCopy(mysql, "jdbcUrl")).toContain("pass%77ord=***&connectTimeout=5000");
  });

  it("adds driver-specific ssl properties", () => {
    expect(buildConnectionUrlCopy(config({ ssl: true }), "jdbcUrl")).toBe("jdbc:postgresql://db.example.com:5432/appdb?ssl=true");
    expect(buildConnectionUrlCopy(config({ db_type: "mysql", port: 3306, ssl: true }), "jdbcUrl")).toBe("jdbc:mysql://db.example.com:3306/appdb?sslMode=REQUIRED");
  });

  it("uses semicolon properties for SQL Server", () => {
    const sqlserver = config({ db_type: "sqlserver", host: "sql.example.com", port: 1433, database: "appdb" });
    expect(buildConnectionUrlCopy(sqlserver, "jdbcUrl")).toBe("jdbc:sqlserver://sql.example.com:1433;databaseName=appdb");
    expect(buildConnectionUrlCopy({ ...sqlserver, ssl: true }, "jdbcUrl")).toBe("jdbc:sqlserver://sql.example.com:1433;databaseName=appdb;encrypt=true");
  });

  it("builds Oracle thin URLs for service names and SIDs", () => {
    const oracle = config({ db_type: "oracle", host: "ora.example.com", port: 1521, database: "ORCLPDB1", username: "", password: "" });
    expect(buildConnectionUrlCopy(oracle, "jdbcUrl")).toBe("jdbc:oracle:thin:@//ora.example.com:1521/ORCLPDB1");
    expect(buildConnectionUrlCopy({ ...oracle, oracle_connection_type: "sid" }, "jdbcUrl")).toBe("jdbc:oracle:thin:@ora.example.com:1521:ORCLPDB1");
  });

  it("passes explicit jdbc: strings without secrets through unchanged", () => {
    const jdbcConfig = config({ db_type: "jdbc", host: "", port: 0, username: "", password: "", database: undefined, connection_string: "jdbc:hive2://zk1:2181,zk2:2181/default;serviceDiscoveryMode=zooKeeper" });
    expect(buildConnectionUrlCopy(jdbcConfig, "jdbcUrl")).toBe(jdbcConfig.connection_string);
  });

  it("selects dialects by driver profile", () => {
    expect(buildConnectionUrlCopy(config({ db_type: "gaussdb", driver_profile: "gaussdb-m" }), "jdbcUrl")).toBe("jdbc:gaussdb://db.example.com:5432/appdb");
    expect(buildConnectionUrlCopy(config({ db_type: "gaussdb" }), "jdbcUrl")).toBe("jdbc:postgresql://db.example.com:5432/appdb");
    expect(buildConnectionUrlCopy(config({ db_type: "gbase8s", port: 9088, driver_profile: "gbase8s" }), "jdbcUrl")).toBe("jdbc:gbasedbt-sqli://db.example.com:9088/appdb");
    expect(buildConnectionUrlCopy(config({ db_type: "gbase", port: 5258, driver_profile: "gbase8a" }), "jdbcUrl")).toBeNull();
    expect(buildConnectionUrlCopy(config({ db_type: "tdengine", port: 6041 }), "jdbcUrl")).toBe("jdbc:TAOS-RS://db.example.com:6041/appdb");
    expect(buildConnectionUrlCopy(config({ db_type: "tdengine", port: 6030 }), "jdbcUrl")).toBe("jdbc:TAOS://db.example.com:6030/appdb");
  });

  it("hides the JDBC item when the dialect is unknown", () => {
    expect(buildConnectionUrlCopy(config({ db_type: "mongodb", port: 27017 }), "jdbcUrl")).toBeNull();
    expect(connectionUrlCopyFormats(config({ db_type: "mongodb", port: 27017 }))).not.toContain("jdbcUrl");
  });

  it("uses the database override for JDBC URLs too", () => {
    expect(buildConnectionUrlCopy(config({}), "jdbcUrl", { database: "analytics" })).toBe("jdbc:postgresql://db.example.com:5432/analytics");
  });

  it("copies host:port", () => {
    expect(buildConnectionUrlCopy(config({}), "hostPort")).toBe("db.example.com:5432");
    expect(buildConnectionUrlCopy(config({ port: 0 }), "hostPort")).toBe("db.example.com");
  });

  it("builds a libpq key=value DSN without the password by default", () => {
    expect(buildConnectionUrlCopy(config({}), "dsn")).toBe("host=db.example.com port=5432 user=app_user dbname=appdb");
    expect(buildConnectionUrlCopy(config({ ssl: true }), "dsn")).toBe("host=db.example.com port=5432 user=app_user dbname=appdb sslmode=require");
  });

  it("redacts both stored and parameter passwords in the plain DSN", () => {
    const postgres = config({ url_params: "password=secondary-secret" });
    expect(buildConnectionUrlCopy(postgres, "dsn")).toBe("host=db.example.com port=5432 user=app_user dbname=appdb password=***");
  });

  it("builds a psql command without embedding the password", () => {
    expect(buildConnectionUrlCopy(config({}), "psqlCommand")).toBe("psql -h db.example.com -p 5432 -U app_user -d appdb");
    expect(buildConnectionUrlCopy(config({ database: undefined }), "psqlCommand", { database: "reporting" })).toBe("psql -h db.example.com -p 5432 -U app_user -d reporting");
  });

  it("restricts DSN and psql to the PostgreSQL wire family", () => {
    expect(connectionUrlCopyFormats(config({ db_type: "mysql", port: 3306 }))).not.toContain("dsn");
    expect(connectionUrlCopyFormats(config({ db_type: "mysql", port: 3306 }))).not.toContain("psqlCommand");
    expect(connectionUrlCopyFormats(config({ db_type: "redshift", port: 5439 }))).toContain("dsn");
    expect(connectionUrlCopyFormats(config({ db_type: "gaussdb", driver_profile: "gaussdb-m" }))).not.toContain("dsn");
    expect(buildConnectionUrlCopy(config({ db_type: "mysql", port: 3306 }), "dsn")).toBeNull();
  });

  it("copies only the endpoint and never represents an API key as Basic-auth userinfo", () => {
    const search = config({ db_type: "elasticsearch", host: "search.example.com", port: 9243, ssl: true, database: "", username: "stale-user", password: "synthetic-api-key", external_config: { authType: "apiKey" } });
    expect(buildConnectionUrlCopy(search, "url")).toBe("https://search.example.com:9243");
    expect(connectionUrlCopyFormats(search)).toEqual(["url", "hostPort"]);
  });
});
