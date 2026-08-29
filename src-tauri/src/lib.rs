#![deny(warnings)]

mod commands;
mod database;
mod error;
mod models;
mod services;
mod state;

use services::backup::get_data_dir;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};

pub use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let root_dir = get_data_dir(&app_data);
            std::fs::create_dir_all(&root_dir)?;
            let _ = services::profile::ProfileService::migrate_legacy_if_needed(&root_dir);

            app.manage(AppState {
                root_dir,
                session: Mutex::new(None),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(state) = window.try_state::<AppState>() {
                    let _ = commands::run_prepare_exit(&state);
                }
                let _ = window.destroy();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::vault_try_auto_unlock,
            commands::vault_init,
            commands::vault_unlock,
            commands::vault_lock,
            commands::vault_logout,
            commands::app_prepare_exit,
            commands::vault_change_password,
            commands::sync_list_remotes,
            commands::sync_get_config,
            commands::sync_upsert_remote,
            commands::sync_delete_remote,
            commands::sync_set_default_remote,
            commands::sync_set_config,
            commands::sync_test_connection,
            commands::sync_pull,
            commands::sync_push,
            commands::sync_resolve_commit,
            commands::get_dashboard,
            commands::quick_capture_parse,
            commands::task_create,
            commands::task_list,
            commands::task_list_today,
            commands::task_update,
            commands::task_complete,
            commands::task_delete,
            commands::habit_create,
            commands::habit_list,
            commands::habit_check_in,
            commands::habit_uncheck,
            commands::habit_delete,
            commands::goal_list,
            commands::goal_detail,
            commands::goal_create,
            commands::goal_update,
            commands::goal_delete,
            commands::goal_add_milestone,
            commands::goal_set_milestone_done,
            commands::goal_delete_milestone,
            commands::finance_create,
            commands::finance_quick_add,
            commands::finance_update,
            commands::finance_list,
            commands::finance_summary,
            commands::finance_delete,
            commands::finance_categories,
            commands::debt_overview,
            commands::debt_list,
            commands::debt_detail,
            commands::debt_create,
            commands::debt_update,
            commands::debt_delete,
            commands::debt_add_payment,
            commands::debt_calibrate_rate,
            commands::debt_create_plan,
            commands::debt_pay_installment,
            commands::quick_note_create,
            commands::quick_note_list,
            commands::quick_note_delete,
            commands::knowledge_tree,
            commands::knowledge_read,
            commands::knowledge_create,
            commands::knowledge_update,
            commands::knowledge_delete,
            commands::knowledge_rename,
            commands::search_query,
            commands::export_backup,
            commands::import_backup,
            commands::export_git_config,
            commands::export_git_config_text,
            commands::import_git_config,
            commands::import_git_config_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod integration_tests {
    use crate::database::Database;
    use crate::models::task::{CreateTaskInput, TaskStatus};
    use crate::services::search::SearchService;
    use crate::services::task::TaskService;
    use tempfile::TempDir;

    fn temp_db() -> (TempDir, Database) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.db");
        let db = Database::new(&path).unwrap();
        (dir, db)
    }

    #[test]
    fn task_crud_and_search() {
        let (_dir, db) = temp_db();
        let svc = TaskService::new(&db);

        let task = svc
            .create(CreateTaskInput {
                title: "完成 RingBuffer 测试".into(),
                description: Some("SPSC queue".into()),
                priority: None,
                due_at: None,
                tags: Some(vec!["cpp".into()]),
            })
            .unwrap();

        assert_eq!(task.status, TaskStatus::Todo);
        svc.complete(&task.id).unwrap();

        let results = SearchService::new(&db).search("RingBuffer", 10).unwrap();
        assert!(!results.is_empty());

        svc.delete(&task.id).unwrap();
        assert!(svc.get(&task.id).is_err());
    }
}
