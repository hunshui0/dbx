//! Provision the fixed DB2 Agent and a charset-complete Java runtime offline.
use std::path::Path;

use dbx_core::agent_manager::{AgentManager, InstalledDriver};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: String,
    source_commit: String,
    agent_sha256: String,
}

pub(crate) fn prepare_db2(resources: &Path, agents: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let payload = resources.join("custom");
    let manifest: Manifest = serde_json::from_slice(&std::fs::read(payload.join("manifest.json"))?)?;
    if manifest.version != env!("CARGO_PKG_VERSION") {
        return Err("DBX Custom payload version does not match the application".into());
    }
    let jar = std::fs::read(payload.join("dbx-agent-db2.jar"))?;
    let actual = format!("{:x}", Sha256::digest(&jar));
    if actual != manifest.agent_sha256 {
        return Err("DBX Custom DB2 Agent checksum mismatch".into());
    }
    let manager = AgentManager::new_with_base_dir_and_app_version(agents.to_path_buf(), &manifest.version);
    let mut state = manager.load_state();
    let driver_dir = manager.driver_dir("db2");
    std::fs::create_dir_all(&driver_dir)?;
    if std::fs::read(manager.driver_jar_path("db2")).ok().as_deref() != Some(jar.as_slice()) {
        std::fs::write(manager.driver_jar_path("db2"), &jar)?;
    }
    let jre = manager.jre_dir("21");
    if state.jre_versions.get("21") != Some(&manifest.version) || !manager.is_jre_installed("21") {
        copy_tree(&payload.join("jre-21"), &jre)?;
    }
    // AgentManager verifies this pin before every launch. Online driver updates
    // cannot replace it; restarting repairs an offline import that overwrote it.
    std::fs::write(driver_dir.join("pinned.sha256"), &actual)?;
    state.installed_drivers.insert(
        "db2".into(),
        InstalledDriver {
            version: manifest.version.clone(),
            installed_at: chrono::Utc::now().to_rfc3339(),
            jre: "21".into(),
        },
    );
    state.jre_versions.insert("21".into(), manifest.version);
    manager.save_state(&state)?;
    log::info!("DBX Custom DB2 Agent ready: commit={} sha256={actual}", manifest.source_commit);
    Ok(())
}

fn copy_tree(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target.join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), target.join(entry.file_name()))?;
        }
    }
    Ok(())
}
