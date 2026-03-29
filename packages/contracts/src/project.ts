import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_CREATE_DIRECTORY_PATH_MAX_LENGTH = 512;
const PROJECT_CLONE_REPOSITORY_URL_MAX_LENGTH = 2048;

export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

const ProjectListDirectoryResultFields = {
  cwd: TrimmedNonEmptyString,
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
} as const;

export const ProjectListDirectoryResult = Schema.Struct(ProjectListDirectoryResultFields);
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export const ProjectCreateDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_CREATE_DIRECTORY_PATH_MAX_LENGTH),
  ),
});
export type ProjectCreateDirectoryInput = typeof ProjectCreateDirectoryInput.Type;

export const ProjectCreateDirectoryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectCreateDirectoryResult = typeof ProjectCreateDirectoryResult.Type;

export const ProjectCloneGitRepositoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  repositoryUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_CLONE_REPOSITORY_URL_MAX_LENGTH),
  ),
});
export type ProjectCloneGitRepositoryInput = typeof ProjectCloneGitRepositoryInput.Type;

export const ProjectCloneGitRepositoryResult = Schema.Struct({
  workspaceRoot: TrimmedNonEmptyString,
});
export type ProjectCloneGitRepositoryResult = typeof ProjectCloneGitRepositoryResult.Type;
