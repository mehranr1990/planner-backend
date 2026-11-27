# Generated Platform Admin API reference

Generated from current OpenAPI, route registries and the server role policy.
Regenerate: `node tooling/scripts/admin-integration-reference.ts --write` after the contracts build.
Check: replace `--write` with `--check`. This is a backend handoff artifact, not frontend source.

208 distinct Admin operations; shared operations appear under each applicable module.
Request, query, response, enum and error schemas are in [OpenAPI](openapi.json).
Roles below express capability eligibility. Recent MFA, current target authority, extra sensitive/export rights, approval separation and transaction rechecks still apply.

Auth rows use the allowlisted authentication state machine; an empty capability does not mean unrestricted access.

## 01 Authentication and RBAC

| Method / path                                         | Operation ID                                | Capability         | Eligible roles                                           |
| ----------------------------------------------------- | ------------------------------------------- | ------------------ | -------------------------------------------------------- |
| GET /api/v1/admin/auth/list-sessions                  | platformAdmin_list_sessions                 | Auth state machine | See auth requirements                                    |
| POST /api/v1/admin/auth/revoke-other-sessions         | platformAdmin_revoke_other_sessions         | Auth state machine | See auth requirements                                    |
| POST /api/v1/admin/auth/revoke-session                | platformAdmin_revoke_session                | Auth state machine | See auth requirements                                    |
| POST /api/v1/admin/auth/revoke-sessions               | platformAdmin_revoke_sessions               | Auth state machine | See auth requirements                                    |
| POST /api/v1/admin/auth/sign-in/email                 | platformAdmin_sign_in_email                 | Auth state machine | See auth requirements                                    |
| POST /api/v1/admin/auth/sign-out                      | platformAdmin_sign_out                      | Auth state machine | See auth requirements                                    |
| POST /api/v1/admin/auth/two-factor/enable             | platformAdmin_two_factor_enable             | Auth state machine | See auth requirements                                    |
| POST /api/v1/admin/auth/two-factor/verify-backup-code | platformAdmin_two_factor_verify_backup_code | Auth state machine | See auth requirements                                    |
| POST /api/v1/admin/auth/two-factor/verify-totp        | platformAdmin_two_factor_verify_totp        | Auth state machine | See auth requirements                                    |
| GET /api/v1/admin/session                             | platformAdminSession                        | admin.session.read | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER, BILLING_MANAGER |

## 02 Dashboard

| Method / path                      | Operation ID                                 | Capability             | Eligible roles                          |
| ---------------------------------- | -------------------------------------------- | ---------------------- | --------------------------------------- |
| GET /api/v1/admin/dashboard        | platformAdminManagement_get_dashboard        | admin.dashboard.read   | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| GET /api/v1/admin/dashboard/export | platformAdminManagement_get_dashboard_export | admin.dashboard.export | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |

## 03 Users

| Method / path                                 | Operation ID                                           | Capability                    | Eligible roles                          |
| --------------------------------------------- | ------------------------------------------------------ | ----------------------------- | --------------------------------------- |
| GET /api/v1/admin/users                       | platformAdminManagement_get_users                      | admin.users.read              | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| GET /api/v1/admin/users/{id}                  | platformAdminManagement_get_users__id                  | admin.users.read              | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| PATCH /api/v1/admin/users/{id}                | platformAdminManagement_patch_users__id                | admin.users.update            | SUPER_ADMIN, SUPPORT                    |
| POST /api/v1/admin/users/{id}/reactivate      | platformAdminManagement_post_users__id_reactivate      | admin.users.reactivate        | SUPER_ADMIN                             |
| POST /api/v1/admin/users/{id}/recovery        | platformAdminManagement_post_users__id_recovery        | admin.users.recovery_initiate | SUPER_ADMIN, SUPPORT                    |
| POST /api/v1/admin/users/{id}/revoke-sessions | platformAdminManagement_post_users__id_revoke_sessions | admin.users.sessions.revoke   | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| POST /api/v1/admin/users/{id}/suspend         | platformAdminManagement_post_users__id_suspend         | admin.users.suspend           | SUPER_ADMIN                             |
| POST /api/v1/admin/users/{id}/verify-email    | platformAdminManagement_post_users__id_verify_email    | admin.users.verify_email      | SUPER_ADMIN                             |
| POST /api/v1/admin/users/bulk/execute         | platformAdminManagement_post_users_bulk_execute        | admin.users.bulk_manage       | SUPER_ADMIN                             |
| POST /api/v1/admin/users/bulk/preview         | platformAdminManagement_post_users_bulk_preview        | admin.users.bulk_manage       | SUPER_ADMIN                             |

## 04 Workspaces

| Method / path                                      | Operation ID                                                | Capability                      | Eligible roles                          |
| -------------------------------------------------- | ----------------------------------------------------------- | ------------------------------- | --------------------------------------- |
| GET /api/v1/admin/workspaces                       | platformAdminManagement_get_workspaces                      | admin.workspaces.read           | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| POST /api/v1/admin/workspaces                      | platformAdminManagement_post_workspaces                     | admin.workspaces.create         | SUPER_ADMIN                             |
| GET /api/v1/admin/workspaces/{id}                  | platformAdminManagement_get_workspaces__id                  | admin.workspaces.read           | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| PATCH /api/v1/admin/workspaces/{id}                | platformAdminManagement_patch_workspaces__id                | admin.workspaces.update         | SUPER_ADMIN                             |
| POST /api/v1/admin/workspaces/{id}/owner-transfers | platformAdminManagement_post_workspaces__id_owner_transfers | admin.workspaces.transfer_owner | SUPER_ADMIN                             |
| POST /api/v1/admin/workspaces/{id}/reactivate      | platformAdminManagement_post_workspaces__id_reactivate      | admin.workspaces.reactivate     | SUPER_ADMIN                             |
| POST /api/v1/admin/workspaces/{id}/suspend         | platformAdminManagement_post_workspaces__id_suspend         | admin.workspaces.suspend        | SUPER_ADMIN                             |
| GET /api/v1/admin/workspaces/retention-policies    | platformAdminManagement_get_workspaces_retention_policies   | admin.workspaces.create         | SUPER_ADMIN                             |

## 05 Memberships

| Method / path                                         | Operation ID                                                   | Capability                           | Eligible roles                          |
| ----------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------ | --------------------------------------- |
| GET /api/v1/admin/users/{id}/memberships              | platformAdminManagement_get_users__id_memberships              | admin.memberships.read               | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| GET /api/v1/admin/workspaces/{id}/invitations         | platformAdminManagement_get_workspaces__id_invitations         | admin.memberships.read               | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| POST /api/v1/admin/workspaces/{id}/invitations/cancel | platformAdminManagement_post_workspaces__id_invitations_cancel | admin.memberships.invitations.manage | SUPER_ADMIN                             |
| POST /api/v1/admin/workspaces/{id}/invitations/resend | platformAdminManagement_post_workspaces__id_invitations_resend | admin.memberships.invitations.manage | SUPER_ADMIN                             |
| GET /api/v1/admin/workspaces/{id}/memberships         | platformAdminManagement_get_workspaces__id_memberships         | admin.memberships.read               | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| POST /api/v1/admin/workspaces/{id}/memberships        | platformAdminManagement_post_workspaces__id_memberships        | admin.memberships.add                | SUPER_ADMIN                             |
| POST /api/v1/admin/workspaces/{id}/memberships/remove | platformAdminManagement_post_workspaces__id_memberships_remove | admin.memberships.remove             | SUPER_ADMIN                             |
| PATCH /api/v1/admin/workspaces/{id}/memberships/role  | platformAdminManagement_patch_workspaces__id_memberships_role  | admin.memberships.update_role        | SUPER_ADMIN                             |

## 06 Security

| Method / path                                           | Operation ID                                             | Capability                            | Eligible roles                 |
| ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------- | ------------------------------ |
| POST /api/v1/admin/security/admins/{id}/block-login     | platformAdminP2_post_security_admins__id_block_login     | admin.security.login.restrict         | SUPER_ADMIN                    |
| POST /api/v1/admin/security/admins/{id}/revoke-sessions | platformAdminP2_post_security_admins__id_revoke_sessions | admin.security.sessions.revoke        | SUPER_ADMIN, SECURITY_REVIEWER |
| GET /api/v1/admin/security/admins/{id}/sessions         | platformAdminP2_get_security_admins__id_sessions         | admin.security.sessions.read          | SUPER_ADMIN, SECURITY_REVIEWER |
| GET /api/v1/admin/security/alerts                       | platformAdminP2_get_security_alerts                      | admin.security.read                   | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/security/approvals                   | platformAdminP2_post_security_approvals                  | admin.security.critical.request       | SUPER_ADMIN                    |
| GET /api/v1/admin/security/approvals/{id}               | platformAdminP2_get_security_approvals__id               | admin.security.critical.request       | SUPER_ADMIN                    |
| POST /api/v1/admin/security/approvals/{id}/approve      | platformAdminP2_post_security_approvals__id_approve      | admin.security.critical.approve       | SUPER_ADMIN                    |
| POST /api/v1/admin/security/approvals/{id}/execute      | platformAdminP2_post_security_approvals__id_execute      | admin.security.critical.request       | SUPER_ADMIN                    |
| POST /api/v1/admin/security/approvals/{id}/reject       | platformAdminP2_post_security_approvals__id_reject       | admin.security.critical.approve       | SUPER_ADMIN                    |
| GET /api/v1/admin/security/policy                       | platformAdminP2_get_security_policy                      | admin.security.read                   | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/security/users/{id}/block-login      | platformAdminP2_post_security_users__id_block_login      | admin.security.user_login.restrict    | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/security/users/{id}/recovery         | platformAdminP2_post_security_users__id_recovery         | admin.security.user_recovery.initiate | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/security/users/{id}/revoke-sessions  | platformAdminP2_post_security_users__id_revoke_sessions  | admin.security.user_sessions.revoke   | SUPER_ADMIN, SECURITY_REVIEWER |
| GET /api/v1/admin/security/users/{id}/sessions          | platformAdminP2_get_security_users__id_sessions          | admin.security.user_sessions.read     | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/security/users/{id}/unblock-login    | platformAdminP2_post_security_users__id_unblock_login    | admin.security.user_login.restrict    | SUPER_ADMIN, SECURITY_REVIEWER |

## 07 Audit

| Method / path                  | Operation ID                     | Capability         | Eligible roles                          |
| ------------------------------ | -------------------------------- | ------------------ | --------------------------------------- |
| GET /api/v1/admin/audit        | platformAdminP2_get_audit        | admin.audit.read   | SUPER_ADMIN, SUPPORT, SECURITY_REVIEWER |
| GET /api/v1/admin/audit/export | platformAdminP2_get_audit_export | admin.audit.export | SUPER_ADMIN, SECURITY_REVIEWER          |

## 08 Privacy and retention

| Method / path                                             | Operation ID                                               | Capability                      | Eligible roles |
| --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------- | -------------- |
| POST /api/v1/admin/privacy/deletion-requests              | platformAdminP2_post_privacy_deletion_requests             | admin.privacy.deletions.request | SUPER_ADMIN    |
| GET /api/v1/admin/privacy/deletion-requests/{id}          | platformAdminP2_get_privacy_deletion_requests__id          | admin.privacy.deletions.read    | SUPER_ADMIN    |
| POST /api/v1/admin/privacy/deletion-requests/{id}/approve | platformAdminP2_post_privacy_deletion_requests__id_approve | admin.privacy.deletions.approve | SUPER_ADMIN    |
| POST /api/v1/admin/privacy/deletion-requests/{id}/execute | platformAdminP2_post_privacy_deletion_requests__id_execute | admin.privacy.deletions.execute | SUPER_ADMIN    |
| GET /api/v1/admin/privacy/deletion-requests/{id}/history  | platformAdminP2_get_privacy_deletion_requests__id_history  | admin.privacy.deletions.read    | SUPER_ADMIN    |
| POST /api/v1/admin/privacy/deletion-requests/{id}/recover | platformAdminP2_post_privacy_deletion_requests__id_recover | admin.privacy.accounts.recover  | SUPER_ADMIN    |
| GET /api/v1/admin/privacy/retention                       | platformAdminP2_get_privacy_retention                      | admin.privacy.retention.read    | SUPER_ADMIN    |
| GET /api/v1/admin/privacy/retention/changes/{id}          | platformAdminP2_get_privacy_retention_changes__id          | admin.privacy.retention.read    | SUPER_ADMIN    |
| POST /api/v1/admin/privacy/retention/changes/{id}/apply   | platformAdminP2_post_privacy_retention_changes__id_apply   | admin.privacy.retention.publish | SUPER_ADMIN    |
| POST /api/v1/admin/privacy/retention/changes/{id}/approve | platformAdminP2_post_privacy_retention_changes__id_approve | admin.privacy.retention.approve | SUPER_ADMIN    |
| POST /api/v1/admin/privacy/retention/expire               | platformAdminP2_post_privacy_retention_expire              | admin.privacy.retention.expire  | SUPER_ADMIN    |
| POST /api/v1/admin/privacy/retention/preview              | platformAdminP2_post_privacy_retention_preview             | admin.privacy.retention.preview | SUPER_ADMIN    |

## 09 Health

| Method / path                                       | Operation ID                                         | Capability                      | Eligible roles                 |
| --------------------------------------------------- | ---------------------------------------------------- | ------------------------------- | ------------------------------ |
| GET /api/v1/admin/operations/health                 | platformAdminP3_get_operations_health                | admin.health.read               | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/operations/health/check          | platformAdminP3_post_operations_health_check         | admin.health.check              | SUPER_ADMIN                    |
| POST /api/v1/admin/operations/health/repair         | platformAdminP3_post_operations_health_repair        | admin.health.repair             | SUPER_ADMIN                    |
| GET /api/v1/admin/operations/incidents              | platformAdminP3_get_operations_incidents             | admin.health.read               | SUPER_ADMIN, SECURITY_REVIEWER |
| GET /api/v1/admin/operations/incidents/{id}/notes   | platformAdminP3_get_operations_incidents__id_notes   | admin.health.notes              | SUPER_ADMIN                    |
| POST /api/v1/admin/operations/incidents/{id}/notes  | platformAdminP3_post_operations_incidents__id_notes  | admin.health.notes              | SUPER_ADMIN                    |
| GET /api/v1/admin/operations/policies               | platformAdminP3_get_operations_policies              | admin.operations.policy.read    | SUPER_ADMIN                    |
| POST /api/v1/admin/operations/policies/{id}/publish | platformAdminP3_post_operations_policies__id_publish | admin.operations.policy.publish | SUPER_ADMIN                    |
| POST /api/v1/admin/operations/policies/preview      | platformAdminP3_post_operations_policies_preview     | admin.operations.policy.publish | SUPER_ADMIN                    |

## 10 Jobs

| Method / path                                       | Operation ID                                         | Capability                      | Eligible roles |
| --------------------------------------------------- | ---------------------------------------------------- | ------------------------------- | -------------- |
| GET /api/v1/admin/operations/job-controls/{id}      | platformAdminP3_get_operations_job_controls__id      | admin.jobs.read                 | SUPER_ADMIN    |
| GET /api/v1/admin/operations/jobs                   | platformAdminP3_get_operations_jobs                  | admin.jobs.read                 | SUPER_ADMIN    |
| POST /api/v1/admin/operations/jobs/{id}/cancel      | platformAdminP3_post_operations_jobs__id_cancel      | admin.jobs.cancel               | SUPER_ADMIN    |
| POST /api/v1/admin/operations/jobs/{id}/retry       | platformAdminP3_post_operations_jobs__id_retry       | admin.jobs.retry                | SUPER_ADMIN    |
| POST /api/v1/admin/operations/jobs/run              | platformAdminP3_post_operations_jobs_run             | admin.jobs.run                  | SUPER_ADMIN    |
| GET /api/v1/admin/operations/policies               | platformAdminP3_get_operations_policies              | admin.operations.policy.read    | SUPER_ADMIN    |
| POST /api/v1/admin/operations/policies/{id}/publish | platformAdminP3_post_operations_policies__id_publish | admin.operations.policy.publish | SUPER_ADMIN    |
| POST /api/v1/admin/operations/policies/preview      | platformAdminP3_post_operations_policies_preview     | admin.operations.policy.publish | SUPER_ADMIN    |

## 11 Storage

| Method / path                                            | Operation ID                                              | Capability                       | Eligible roles |
| -------------------------------------------------------- | --------------------------------------------------------- | -------------------------------- | -------------- |
| GET /api/v1/admin/operations/policies                    | platformAdminP3_get_operations_policies                   | admin.operations.policy.read     | SUPER_ADMIN    |
| POST /api/v1/admin/operations/policies/{id}/publish      | platformAdminP3_post_operations_policies__id_publish      | admin.operations.policy.publish  | SUPER_ADMIN    |
| POST /api/v1/admin/operations/policies/preview           | platformAdminP3_post_operations_policies_preview          | admin.operations.policy.publish  | SUPER_ADMIN    |
| POST /api/v1/admin/operations/storage/cleanup/{id}/apply | platformAdminP3_post_operations_storage_cleanup__id_apply | admin.storage.cleanup            | SUPER_ADMIN    |
| POST /api/v1/admin/operations/storage/cleanup/preview    | platformAdminP3_post_operations_storage_cleanup_preview   | admin.storage.cleanup            | SUPER_ADMIN    |
| GET /api/v1/admin/operations/storage/files/{id}/content  | platformAdminP3_get_operations_storage_files__id_content  | admin.storage.private_files.read | SUPER_ADMIN    |
| GET /api/v1/admin/operations/storage/usage               | platformAdminP3_get_operations_storage_usage              | admin.storage.read               | SUPER_ADMIN    |

## 12 Backup and restore

| Method / path                                       | Operation ID                                         | Capability                      | Eligible roles |
| --------------------------------------------------- | ---------------------------------------------------- | ------------------------------- | -------------- |
| GET /api/v1/admin/operations/backups                | platformAdminP3_get_operations_backups               | admin.backups.read              | SUPER_ADMIN    |
| POST /api/v1/admin/operations/backups               | platformAdminP3_post_operations_backups              | admin.backups.request           | SUPER_ADMIN    |
| GET /api/v1/admin/operations/backups/{id}           | platformAdminP3_get_operations_backups__id           | admin.backups.read              | SUPER_ADMIN    |
| GET /api/v1/admin/operations/policies               | platformAdminP3_get_operations_policies              | admin.operations.policy.read    | SUPER_ADMIN    |
| POST /api/v1/admin/operations/policies/{id}/publish | platformAdminP3_post_operations_policies__id_publish | admin.operations.policy.publish | SUPER_ADMIN    |
| POST /api/v1/admin/operations/policies/preview      | platformAdminP3_post_operations_policies_preview     | admin.operations.policy.publish | SUPER_ADMIN    |
| GET /api/v1/admin/operations/restores               | platformAdminP3_get_operations_restores              | admin.restores.read             | SUPER_ADMIN    |
| POST /api/v1/admin/operations/restores              | platformAdminP3_post_operations_restores             | admin.restores.request          | SUPER_ADMIN    |
| POST /api/v1/admin/operations/restores/{id}/approve | platformAdminP3_post_operations_restores__id_approve | admin.restores.approve          | SUPER_ADMIN    |

## 13 Communications

| Method / path                                            | Operation ID                                              | Capability                     | Eligible roles |
| -------------------------------------------------------- | --------------------------------------------------------- | ------------------------------ | -------------- |
| GET /api/v1/admin/communications                         | platformAdminP2_get_communications                        | admin.communications.read      | SUPER_ADMIN    |
| GET /api/v1/admin/communications/{id}                    | platformAdminP4_get_communications__id                    | admin.communications.read      | SUPER_ADMIN    |
| POST /api/v1/admin/communications/{id}/approve           | platformAdminP4_post_communications__id_approve           | admin.communications.approve   | SUPER_ADMIN    |
| POST /api/v1/admin/communications/{id}/cancel            | platformAdminP4_post_communications__id_cancel            | admin.communications.send      | SUPER_ADMIN    |
| POST /api/v1/admin/communications/{id}/send              | platformAdminP4_post_communications__id_send              | admin.communications.send      | SUPER_ADMIN    |
| GET /api/v1/admin/communications/{id}/targets            | platformAdminP4_get_communications__id_targets            | admin.communications.read      | SUPER_ADMIN    |
| POST /api/v1/admin/communications/{id}/test              | platformAdminP4_post_communications__id_test              | admin.communications.send      | SUPER_ADMIN    |
| POST /api/v1/admin/communications/preview                | platformAdminP4_post_communications_preview               | admin.communications.send      | SUPER_ADMIN    |
| GET /api/v1/admin/communications/templates               | platformAdminP4_get_communications_templates              | admin.communications.read      | SUPER_ADMIN    |
| POST /api/v1/admin/communications/templates              | platformAdminP4_post_communications_templates             | admin.communications.templates | SUPER_ADMIN    |
| POST /api/v1/admin/communications/templates/{id}/approve | platformAdminP4_post_communications_templates__id_approve | admin.communications.approve   | SUPER_ADMIN    |
| POST /api/v1/admin/communications/templates/{id}/archive | platformAdminP4_post_communications_templates__id_archive | admin.communications.templates | SUPER_ADMIN    |
| GET /api/v1/admin/engagement/policies                    | platformAdminP4_get_engagement_policies                   | admin.engagement.configure     | SUPER_ADMIN    |
| PATCH /api/v1/admin/engagement/policies/{id}             | platformAdminP4_patch_engagement_policies__id             | admin.engagement.configure     | SUPER_ADMIN    |
| POST /api/v1/admin/engagement/policies/{id}/preview      | platformAdminP4_post_engagement_policies__id_preview      | admin.engagement.configure     | SUPER_ADMIN    |

## 14 Support

| Method / path                                       | Operation ID                                         | Capability                 | Eligible roles       |
| --------------------------------------------------- | ---------------------------------------------------- | -------------------------- | -------------------- |
| GET /api/v1/admin/engagement/policies               | platformAdminP4_get_engagement_policies              | admin.engagement.configure | SUPER_ADMIN          |
| PATCH /api/v1/admin/engagement/policies/{id}        | platformAdminP4_patch_engagement_policies__id        | admin.engagement.configure | SUPER_ADMIN          |
| POST /api/v1/admin/engagement/policies/{id}/preview | platformAdminP4_post_engagement_policies__id_preview | admin.engagement.configure | SUPER_ADMIN          |
| GET /api/v1/admin/support/notices                   | platformAdminP4_get_support_notices                  | admin.support.read         | SUPER_ADMIN, SUPPORT |
| POST /api/v1/admin/support/notices/{id}/read        | platformAdminP4_post_support_notices__id_read        | admin.support.read         | SUPER_ADMIN, SUPPORT |
| GET /api/v1/admin/support/queues                    | platformAdminP4_get_support_queues                   | admin.support.read         | SUPER_ADMIN, SUPPORT |
| POST /api/v1/admin/support/queues                   | platformAdminP4_post_support_queues                  | admin.support.configure    | SUPER_ADMIN          |
| PATCH /api/v1/admin/support/queues/{id}             | platformAdminP4_patch_support_queues__id             | admin.support.configure    | SUPER_ADMIN          |
| GET /api/v1/admin/support/tickets                   | platformAdminP4_get_support_tickets                  | admin.support.read         | SUPER_ADMIN, SUPPORT |
| GET /api/v1/admin/support/tickets/{id}              | platformAdminP4_get_support_tickets__id              | admin.support.read         | SUPER_ADMIN, SUPPORT |
| POST /api/v1/admin/support/tickets/{id}/archive     | platformAdminP4_post_support_tickets__id_archive     | admin.support.configure    | SUPER_ADMIN          |
| POST /api/v1/admin/support/tickets/{id}/assign      | platformAdminP4_post_support_tickets__id_assign      | admin.support.assign       | SUPER_ADMIN, SUPPORT |
| GET /api/v1/admin/support/tickets/{id}/evidence     | platformAdminP4_get_support_tickets__id_evidence     | admin.support.read         | SUPER_ADMIN, SUPPORT |
| POST /api/v1/admin/support/tickets/{id}/replies     | platformAdminP4_post_support_tickets__id_replies     | admin.support.reply        | SUPER_ADMIN, SUPPORT |
| POST /api/v1/admin/support/tickets/{id}/state       | platformAdminP4_post_support_tickets__id_state       | admin.support.reply        | SUPER_ADMIN, SUPPORT |

## 15 Moderation

| Method / path                                       | Operation ID                                         | Capability                    | Eligible roles                 |
| --------------------------------------------------- | ---------------------------------------------------- | ----------------------------- | ------------------------------ |
| GET /api/v1/admin/engagement/policies               | platformAdminP4_get_engagement_policies              | admin.engagement.configure    | SUPER_ADMIN                    |
| PATCH /api/v1/admin/engagement/policies/{id}        | platformAdminP4_patch_engagement_policies__id        | admin.engagement.configure    | SUPER_ADMIN                    |
| POST /api/v1/admin/engagement/policies/{id}/preview | platformAdminP4_post_engagement_policies__id_preview | admin.engagement.configure    | SUPER_ADMIN                    |
| GET /api/v1/admin/moderation/cases                  | platformAdminP4_get_moderation_cases                 | admin.moderation.read         | SUPER_ADMIN, SECURITY_REVIEWER |
| GET /api/v1/admin/moderation/cases/{id}             | platformAdminP4_get_moderation_cases__id             | admin.moderation.read         | SUPER_ADMIN, SECURITY_REVIEWER |
| GET /api/v1/admin/moderation/cases/{id}/content     | platformAdminP4_get_moderation_cases__id_content     | admin.moderation.content.read | SUPER_ADMIN, SECURITY_REVIEWER |
| GET /api/v1/admin/moderation/cases/{id}/evidence    | platformAdminP4_get_moderation_cases__id_evidence    | admin.moderation.content.read | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/moderation/cases/{id}/penalty    | platformAdminP4_post_moderation_cases__id_penalty    | admin.moderation.penalty      | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/moderation/cases/{id}/state      | platformAdminP4_post_moderation_cases__id_state      | admin.moderation.manage       | SUPER_ADMIN, SECURITY_REVIEWER |
| GET /api/v1/admin/moderation/escalations            | platformAdminP4_get_moderation_escalations           | admin.security.read           | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/moderation/escalations/{id}/read | platformAdminP4_post_moderation_escalations__id_read | admin.security.read           | SUPER_ADMIN, SECURITY_REVIEWER |
| POST /api/v1/admin/moderation/reports               | platformAdminP4_post_moderation_reports              | admin.moderation.report       | SUPER_ADMIN, SECURITY_REVIEWER |

## 16 Plans

| Method / path                                     | Operation ID                                       | Capability                 | Eligible roles               |
| ------------------------------------------------- | -------------------------------------------------- | -------------------------- | ---------------------------- |
| GET /api/v1/admin/commerce/features               | platformAdminP2_get_commerce_features              | admin.plans.read           | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/features              | platformAdminP2_post_commerce_features             | admin.plans.manage         | SUPER_ADMIN                  |
| POST /api/v1/admin/commerce/features/{id}         | platformAdminP2_post_commerce_features__id         | admin.plans.manage         | SUPER_ADMIN                  |
| GET /api/v1/admin/commerce/policy                 | platformAdminP2_get_commerce_policy                | admin.plans.read           | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/policy                | platformAdminP2_post_commerce_policy               | admin.commercial.configure | SUPER_ADMIN                  |
| GET /api/v1/admin/commerce/prices                 | platformAdminP2_get_commerce_prices                | admin.plans.read           | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/prices                | platformAdminP2_post_commerce_prices               | admin.plans.manage         | SUPER_ADMIN                  |
| POST /api/v1/admin/commerce/prices/{id}           | platformAdminP2_post_commerce_prices__id           | admin.plans.manage         | SUPER_ADMIN                  |
| GET /api/v1/admin/commerce/products               | platformAdminP2_get_commerce_products              | admin.plans.read           | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/products              | platformAdminP2_post_commerce_products             | admin.plans.manage         | SUPER_ADMIN                  |
| POST /api/v1/admin/commerce/products/{id}         | platformAdminP2_post_commerce_products__id         | admin.plans.manage         | SUPER_ADMIN                  |
| POST /api/v1/admin/commerce/products/{id}/publish | platformAdminP2_post_commerce_products__id_publish | admin.plans.manage         | SUPER_ADMIN                  |
| GET /api/v1/admin/commerce/products/{id}/versions | platformAdminP2_get_commerce_products__id_versions | admin.plans.read           | SUPER_ADMIN, BILLING_MANAGER |

## 17 Subscriptions

| Method / path                                                | Operation ID                                                  | Capability                 | Eligible roles               |
| ------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------- | ---------------------------- |
| GET /api/v1/admin/commerce/customers                         | platformAdminP2_get_commerce_customers                        | admin.subscriptions.read   | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/customers                        | platformAdminP2_post_commerce_customers                       | admin.subscriptions.manage | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/commerce/customers/{id}/entitlements       | platformAdminP2_get_commerce_customers__id_entitlements       | admin.subscriptions.read   | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/commerce/customers/{id}/history            | platformAdminP2_get_commerce_customers__id_history            | admin.subscriptions.read   | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/commerce/customers/{id}/overrides          | platformAdminP2_get_commerce_customers__id_overrides          | admin.subscriptions.read   | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/customers/{id}/overrides         | platformAdminP2_post_commerce_customers__id_overrides         | admin.entitlements.manage  | SUPER_ADMIN                  |
| GET /api/v1/admin/commerce/customers/{id}/subscriptions      | platformAdminP2_get_commerce_customers__id_subscriptions      | admin.subscriptions.read   | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/customers/{id}/subscriptions     | platformAdminP2_post_commerce_customers__id_subscriptions     | admin.subscriptions.manage | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/overrides/{id}/revoke            | platformAdminP2_post_commerce_overrides__id_revoke            | admin.entitlements.manage  | SUPER_ADMIN                  |
| POST /api/v1/admin/commerce/subscriptions/{id}/cancel        | platformAdminP2_post_commerce_subscriptions__id_cancel        | admin.subscriptions.manage | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/subscriptions/{id}/change        | platformAdminP2_post_commerce_subscriptions__id_change        | admin.subscriptions.manage | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/subscriptions/{id}/pause         | platformAdminP2_post_commerce_subscriptions__id_pause         | admin.subscriptions.manage | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/subscriptions/{id}/reactivate    | platformAdminP2_post_commerce_subscriptions__id_reactivate    | admin.subscriptions.manage | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/subscriptions/{id}/renew         | platformAdminP2_post_commerce_subscriptions__id_renew         | admin.subscriptions.manage | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/subscriptions/{id}/renewal-price | platformAdminP2_post_commerce_subscriptions__id_renewal_price | admin.subscriptions.manage | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/commerce/subscriptions/{id}/terms          | platformAdminP2_get_commerce_subscriptions__id_terms          | admin.subscriptions.read   | SUPER_ADMIN, BILLING_MANAGER |

## 18 Billing

| Method / path                                               | Operation ID                                                 | Capability              | Eligible roles               |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ----------------------- | ---------------------------- |
| GET /api/v1/admin/commerce/customers/{id}/credit            | platformAdminP2_get_commerce_customers__id_credit            | admin.billing.read      | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/customers/{id}/financial-grants | platformAdminP2_post_commerce_customers__id_financial_grants | admin.billing.grants    | SUPER_ADMIN                  |
| GET /api/v1/admin/commerce/customers/{id}/invoices          | platformAdminP2_get_commerce_customers__id_invoices          | admin.billing.read      | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/customers/{id}/invoices         | platformAdminP2_post_commerce_customers__id_invoices         | admin.billing.manage    | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/commerce/customers/{id}/ledger            | platformAdminP2_get_commerce_customers__id_ledger            | admin.billing.read      | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/commerce/customers/{id}/payments          | platformAdminP2_get_commerce_customers__id_payments          | admin.billing.read      | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/customers/{id}/payments         | platformAdminP2_post_commerce_customers__id_payments         | admin.billing.manage    | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/commerce/customers/{id}/refunds           | platformAdminP2_get_commerce_customers__id_refunds           | admin.billing.read      | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/invoices/{id}/apply-credit      | platformAdminP2_post_commerce_invoices__id_apply_credit      | admin.billing.manage    | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/invoices/{id}/correct           | platformAdminP2_post_commerce_invoices__id_correct           | admin.billing.correct   | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/invoices/{id}/issue             | platformAdminP2_post_commerce_invoices__id_issue             | admin.billing.manage    | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/invoices/{id}/void              | platformAdminP2_post_commerce_invoices__id_void              | admin.billing.correct   | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/invoices/{id}/write-off         | platformAdminP2_post_commerce_invoices__id_write_off         | admin.billing.write_off | SUPER_ADMIN                  |
| GET /api/v1/admin/commerce/methods                          | platformAdminP2_get_commerce_methods                         | admin.billing.read      | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/methods                         | platformAdminP2_post_commerce_methods                        | admin.billing.manage    | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/methods/{id}                    | platformAdminP2_post_commerce_methods__id                    | admin.billing.manage    | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/payments/{id}/refund            | platformAdminP2_post_commerce_payments__id_refund            | admin.billing.refund    | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/payments/{id}/verify            | platformAdminP2_post_commerce_payments__id_verify            | admin.billing.verify    | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/commerce/promotions                       | platformAdminP2_get_commerce_promotions                      | admin.billing.read      | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/promotions                      | platformAdminP2_post_commerce_promotions                     | admin.billing.manage    | SUPER_ADMIN, BILLING_MANAGER |
| POST /api/v1/admin/commerce/promotions/{id}                 | platformAdminP2_post_commerce_promotions__id                 | admin.billing.manage    | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/commerce/reports                          | platformAdminP2_get_commerce_reports                         | admin.billing.read      | SUPER_ADMIN, BILLING_MANAGER |

## 19 Feature flags

| Method / path                                                         | Operation ID                                                           | Capability                  | Eligible roles |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------- | -------------- |
| GET /api/v1/admin/configuration/catalog                               | platformAdminP6_get_configuration_catalog                              | admin.configuration.read    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions                           | platformAdminP6_get_configuration_definitions                          | admin.configuration.read    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions                          | platformAdminP6_post_configuration_definitions                         | admin.configuration.draft   | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions/{id}/drafts              | platformAdminP6_post_configuration_definitions__id_drafts              | admin.configuration.draft   | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/effective            | platformAdminP6_get_configuration_definitions__id_effective            | admin.configuration.inspect | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/events               | platformAdminP6_get_configuration_definitions__id_events               | admin.configuration.read    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/history              | platformAdminP6_get_configuration_definitions__id_history              | admin.configuration.read    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions/{id}/kill                | platformAdminP6_post_configuration_definitions__id_kill                | admin.configuration.kill    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/kill-release-preview | platformAdminP6_get_configuration_definitions__id_kill_release_preview | admin.configuration.kill    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions/{id}/rollback            | platformAdminP6_post_configuration_definitions__id_rollback            | admin.configuration.draft   | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/drafts/{id}                           | platformAdminP6_get_configuration_drafts__id                           | admin.configuration.read    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/drafts/{id}/preview                  | platformAdminP6_post_configuration_drafts__id_preview                  | admin.configuration.preview | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/drafts/{id}/publish                  | platformAdminP6_post_configuration_drafts__id_publish                  | admin.configuration.publish | SUPER_ADMIN    |

## 20 Product configuration

| Method / path                                                         | Operation ID                                                           | Capability                  | Eligible roles |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------- | -------------- |
| GET /api/v1/admin/configuration/catalog                               | platformAdminP6_get_configuration_catalog                              | admin.configuration.read    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions                           | platformAdminP6_get_configuration_definitions                          | admin.configuration.read    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions                          | platformAdminP6_post_configuration_definitions                         | admin.configuration.draft   | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions/{id}/drafts              | platformAdminP6_post_configuration_definitions__id_drafts              | admin.configuration.draft   | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/effective            | platformAdminP6_get_configuration_definitions__id_effective            | admin.configuration.inspect | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/events               | platformAdminP6_get_configuration_definitions__id_events               | admin.configuration.read    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/history              | platformAdminP6_get_configuration_definitions__id_history              | admin.configuration.read    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions/{id}/kill                | platformAdminP6_post_configuration_definitions__id_kill                | admin.configuration.kill    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/kill-release-preview | platformAdminP6_get_configuration_definitions__id_kill_release_preview | admin.configuration.kill    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions/{id}/rollback            | platformAdminP6_post_configuration_definitions__id_rollback            | admin.configuration.draft   | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/drafts/{id}                           | platformAdminP6_get_configuration_drafts__id                           | admin.configuration.read    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/drafts/{id}/preview                  | platformAdminP6_post_configuration_drafts__id_preview                  | admin.configuration.preview | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/drafts/{id}/publish                  | platformAdminP6_post_configuration_drafts__id_publish                  | admin.configuration.publish | SUPER_ADMIN    |

## 21 Platform settings and maintenance

| Method / path                                                         | Operation ID                                                           | Capability                  | Eligible roles |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------- | -------------- |
| GET /api/v1/admin/configuration/catalog                               | platformAdminP6_get_configuration_catalog                              | admin.configuration.read    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions                           | platformAdminP6_get_configuration_definitions                          | admin.configuration.read    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions                          | platformAdminP6_post_configuration_definitions                         | admin.configuration.draft   | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions/{id}/drafts              | platformAdminP6_post_configuration_definitions__id_drafts              | admin.configuration.draft   | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/effective            | platformAdminP6_get_configuration_definitions__id_effective            | admin.configuration.inspect | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/events               | platformAdminP6_get_configuration_definitions__id_events               | admin.configuration.read    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/history              | platformAdminP6_get_configuration_definitions__id_history              | admin.configuration.read    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions/{id}/kill                | platformAdminP6_post_configuration_definitions__id_kill                | admin.configuration.kill    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/definitions/{id}/kill-release-preview | platformAdminP6_get_configuration_definitions__id_kill_release_preview | admin.configuration.kill    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/definitions/{id}/rollback            | platformAdminP6_post_configuration_definitions__id_rollback            | admin.configuration.draft   | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/drafts/{id}                           | platformAdminP6_get_configuration_drafts__id                           | admin.configuration.read    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/drafts/{id}/preview                  | platformAdminP6_post_configuration_drafts__id_preview                  | admin.configuration.preview | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/drafts/{id}/publish                  | platformAdminP6_post_configuration_drafts__id_publish                  | admin.configuration.publish | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/versions/{id}/readiness               | platformAdminP6_get_configuration_versions__id_readiness               | admin.maintenance.reopen    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/versions/{id}/reopen                 | platformAdminP6_post_configuration_versions__id_reopen                 | admin.maintenance.reopen    | SUPER_ADMIN    |
| GET /api/v1/admin/configuration/versions/{id}/reopen-schedule         | platformAdminP6_get_configuration_versions__id_reopen_schedule         | admin.maintenance.reopen    | SUPER_ADMIN    |
| POST /api/v1/admin/configuration/versions/{id}/schedule-reopen        | platformAdminP6_post_configuration_versions__id_schedule_reopen        | admin.maintenance.reopen    | SUPER_ADMIN    |

## 22 Product analytics

| Method / path                                    | Operation ID                                      | Capability                     | Eligible roles               |
| ------------------------------------------------ | ------------------------------------------------- | ------------------------------ | ---------------------------- |
| GET /api/v1/admin/analytics/catalog              | platformAdminP7_get_analytics_catalog             | admin.analytics.product.read   | SUPER_ADMIN                  |
| POST /api/v1/admin/analytics/compare             | platformAdminP7_post_analytics_compare            | admin.analytics.product.read   | SUPER_ADMIN                  |
| GET /api/v1/admin/analytics/definitions          | platformAdminP7_get_analytics_definitions         | admin.analytics.product.read   | SUPER_ADMIN                  |
| POST /api/v1/admin/analytics/definitions         | platformAdminP7_post_analytics_definitions        | admin.analytics.configure      | SUPER_ADMIN                  |
| POST /api/v1/admin/analytics/financial           | platformAdminP7_post_analytics_financial          | admin.analytics.financial.read | SUPER_ADMIN, BILLING_MANAGER |
| GET /api/v1/admin/analytics/policy               | platformAdminP7_get_analytics_policy              | admin.analytics.sensitive.read | SUPER_ADMIN                  |
| POST /api/v1/admin/analytics/policy              | platformAdminP7_post_analytics_policy             | admin.analytics.configure      | SUPER_ADMIN                  |
| POST /api/v1/admin/analytics/policy/preview      | platformAdminP7_post_analytics_policy_preview     | admin.analytics.configure      | SUPER_ADMIN                  |
| POST /api/v1/admin/analytics/query               | platformAdminP7_post_analytics_query              | admin.analytics.product.read   | SUPER_ADMIN                  |
| GET /api/v1/admin/analytics/reports              | platformAdminP7_get_analytics_reports             | admin.analytics.export         | SUPER_ADMIN                  |
| POST /api/v1/admin/analytics/reports             | platformAdminP7_post_analytics_reports            | admin.analytics.export         | SUPER_ADMIN                  |
| GET /api/v1/admin/analytics/reports/{id}         | platformAdminP7_get_analytics_reports__id         | admin.analytics.export         | SUPER_ADMIN                  |
| POST /api/v1/admin/analytics/reports/{id}/cancel | platformAdminP7_post_analytics_reports__id_cancel | admin.analytics.export         | SUPER_ADMIN                  |

## Exact role capability sets

### SUPER_ADMIN

`admin.analytics.configure`, `admin.analytics.export`, `admin.analytics.financial.read`, `admin.analytics.product.read`, `admin.analytics.sensitive.read`, `admin.audit.category.control`, `admin.audit.category.privacy`, `admin.audit.category.security`, `admin.audit.export`, `admin.audit.read`, `admin.audit.sensitive`, `admin.backups.read`, `admin.backups.request`, `admin.billing.correct`, `admin.billing.grants`, `admin.billing.manage`, `admin.billing.read`, `admin.billing.refund`, `admin.billing.verify`, `admin.billing.write_off`, `admin.commercial.configure`, `admin.communications.approve`, `admin.communications.read`, `admin.communications.send`, `admin.communications.templates`, `admin.configuration.draft`, `admin.configuration.inspect`, `admin.configuration.kill`, `admin.configuration.preview`, `admin.configuration.publish`, `admin.configuration.read`, `admin.configuration.sensitive.publish`, `admin.dashboard.export`, `admin.dashboard.read`, `admin.engagement.configure`, `admin.entitlements.manage`, `admin.health.check`, `admin.health.notes`, `admin.health.read`, `admin.health.repair`, `admin.jobs.cancel`, `admin.jobs.read`, `admin.jobs.retry`, `admin.jobs.run`, `admin.maintenance.reopen`, `admin.memberships.add`, `admin.memberships.invitations.manage`, `admin.memberships.read`, `admin.memberships.remove`, `admin.memberships.update_role`, `admin.moderation.content.read`, `admin.moderation.manage`, `admin.moderation.penalty`, `admin.moderation.read`, `admin.moderation.report`, `admin.operations.policy.publish`, `admin.operations.policy.read`, `admin.plans.manage`, `admin.plans.read`, `admin.privacy.accounts.delete`, `admin.privacy.accounts.recover`, `admin.privacy.deletions.approve`, `admin.privacy.deletions.execute`, `admin.privacy.deletions.read`, `admin.privacy.deletions.request`, `admin.privacy.retention.approve`, `admin.privacy.retention.expire`, `admin.privacy.retention.preview`, `admin.privacy.retention.publish`, `admin.privacy.retention.read`, `admin.privacy.workspaces.delete`, `admin.restores.approve`, `admin.restores.read`, `admin.restores.request`, `admin.security.critical.approve`, `admin.security.critical.request`, `admin.security.login.restrict`, `admin.security.read`, `admin.security.sessions.read`, `admin.security.sessions.revoke`, `admin.security.user_login.restrict`, `admin.security.user_recovery.initiate`, `admin.security.user_sessions.read`, `admin.security.user_sessions.revoke`, `admin.session.read`, `admin.session.revoke`, `admin.storage.cleanup`, `admin.storage.private_files.read`, `admin.storage.read`, `admin.subscriptions.manage`, `admin.subscriptions.read`, `admin.super`, `admin.support.assign`, `admin.support.configure`, `admin.support.read`, `admin.support.reply`, `admin.users.bulk_manage`, `admin.users.reactivate`, `admin.users.read`, `admin.users.recovery_initiate`, `admin.users.sessions.revoke`, `admin.users.suspend`, `admin.users.update`, `admin.users.verify_email`, `admin.workspaces.create`, `admin.workspaces.reactivate`, `admin.workspaces.read`, `admin.workspaces.suspend`, `admin.workspaces.transfer_owner`, `admin.workspaces.update`.

### SUPPORT

`admin.audit.category.control`, `admin.audit.read`, `admin.dashboard.export`, `admin.dashboard.read`, `admin.memberships.read`, `admin.session.read`, `admin.session.revoke`, `admin.support.assign`, `admin.support.read`, `admin.support.reply`, `admin.users.read`, `admin.users.recovery_initiate`, `admin.users.sessions.revoke`, `admin.users.update`, `admin.workspaces.read`.

### SECURITY_REVIEWER

`admin.audit.category.security`, `admin.audit.export`, `admin.audit.read`, `admin.dashboard.export`, `admin.dashboard.read`, `admin.health.read`, `admin.memberships.read`, `admin.moderation.content.read`, `admin.moderation.manage`, `admin.moderation.penalty`, `admin.moderation.read`, `admin.moderation.report`, `admin.security.read`, `admin.security.sessions.read`, `admin.security.sessions.revoke`, `admin.security.user_login.restrict`, `admin.security.user_recovery.initiate`, `admin.security.user_sessions.read`, `admin.security.user_sessions.revoke`, `admin.session.read`, `admin.session.revoke`, `admin.users.read`, `admin.users.sessions.revoke`, `admin.workspaces.read`.

### BILLING_MANAGER

`admin.analytics.financial.read`, `admin.billing.correct`, `admin.billing.manage`, `admin.billing.read`, `admin.billing.refund`, `admin.billing.verify`, `admin.plans.read`, `admin.session.read`, `admin.session.revoke`, `admin.subscriptions.manage`, `admin.subscriptions.read`.
