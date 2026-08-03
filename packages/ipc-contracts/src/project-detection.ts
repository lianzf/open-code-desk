import { z } from 'zod';

import { projectTypeSchema, runConfigurationDraftSchema } from './run';
import { appLocaleSchema } from './settings';

const workspaceIdSchema = z.string().uuid();
const relativePathSchema = z.string().max(2_048);

export const projectDetectionEvidenceSchema = z
  .object({
    path: relativePathSchema,
    reason: z.string().min(1).max(2_000),
  })
  .strict();

export const runtimeCandidateKindSchema = z.enum(['python']);
export const runtimeCandidateSourceSchema = z.enum([
  'workspace-venv',
  'active-environment',
  'path',
  'fallback',
]);

export const runtimeCandidateSchema = z
  .object({
    kind: runtimeCandidateKindSchema,
    executable: z.string().trim().min(1).max(2_048),
    label: z.string().trim().min(1).max(300),
    source: runtimeCandidateSourceSchema,
    available: z.boolean(),
    recommended: z.boolean(),
    version: z.string().trim().min(1).max(100).optional(),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const projectDetectionSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    detectedTypes: z.array(projectTypeSchema).min(1).max(20),
    primaryType: projectTypeSchema,
    evidence: z.array(projectDetectionEvidenceSchema).max(100),
    runtimeCandidates: z.array(runtimeCandidateSchema).max(100),
    suggestedConfigurations: z.array(runConfigurationDraftSchema).max(100),
  })
  .strict()
  .superRefine((detection, context) => {
    if (!detection.detectedTypes.includes(detection.primaryType)) {
      context.addIssue({
        code: 'custom',
        message: 'The primary project type must be included in detectedTypes.',
        path: ['primaryType'],
      });
    }
    for (const [index, configuration] of detection.suggestedConfigurations.entries()) {
      if (configuration.workspaceId !== detection.workspaceId) {
        context.addIssue({
          code: 'custom',
          message: 'Suggested configurations must belong to the detected workspace.',
          path: ['suggestedConfigurations', index, 'workspaceId'],
        });
      }
    }
  });

export const detectProjectRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, locale: appLocaleSchema })
  .strict();

export type ProjectDetectionEvidence = z.infer<typeof projectDetectionEvidenceSchema>;
export type RuntimeCandidateKind = z.infer<typeof runtimeCandidateKindSchema>;
export type RuntimeCandidateSource = z.infer<typeof runtimeCandidateSourceSchema>;
export type RuntimeCandidate = z.infer<typeof runtimeCandidateSchema>;
export type ProjectDetection = z.infer<typeof projectDetectionSchema>;
export type DetectProjectRequest = z.infer<typeof detectProjectRequestSchema>;
