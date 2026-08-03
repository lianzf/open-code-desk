import { z } from 'zod';

import { pendingRunExecutionSchema } from './run-execution';
import { uuidSchema, workspaceIdSchema } from './run-internal';

export const compoundRunConfigurationSchema = z
  .object({
    id: uuidSchema,
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(1).max(200),
    configurationIds: z.array(uuidSchema).min(2).max(20),
    stopAllOnSingleFailure: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (new Set(configuration.configurationIds).size !== configuration.configurationIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Compound run configurations cannot contain duplicate services.',
        path: ['configurationIds'],
      });
    }
  });

export const compoundRunConfigurationListSchema = z.array(compoundRunConfigurationSchema).max(100);

export const saveCompoundRunConfigurationRequestSchema = z
  .object({
    id: uuidSchema.optional(),
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(1).max(200),
    configurationIds: z.array(uuidSchema).min(2).max(20),
    stopAllOnSingleFailure: z.boolean().default(true),
  })
  .strict();

export const deleteCompoundRunConfigurationRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, compoundConfigurationId: uuidSchema })
  .strict();

export const proposeCompoundRunRequestSchema = deleteCompoundRunConfigurationRequestSchema;

export const listCompoundRunSessionsRequestSchema = z
  .object({ workspaceId: workspaceIdSchema })
  .strict();

export const compoundRunSessionSchema = z
  .object({
    id: uuidSchema,
    workspaceId: workspaceIdSchema,
    compoundConfigurationId: uuidSchema,
    compoundConfigurationName: z.string().trim().min(1).max(200),
    executionIds: z.array(uuidSchema).min(1).max(20),
    stopAllOnSingleFailure: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const compoundRunSessionListSchema = z.array(compoundRunSessionSchema).max(100);

export const compoundRunProposalSchema = z
  .object({
    session: compoundRunSessionSchema,
    executions: z.array(pendingRunExecutionSchema).min(1).max(20),
  })
  .strict()
  .superRefine((proposal, context) => {
    const executionIds = proposal.executions.map((execution) => execution.id);
    if (
      proposal.session.executionIds.length !== executionIds.length ||
      proposal.session.executionIds.some((executionId) => !executionIds.includes(executionId))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Compound session execution IDs must match its pending executions.',
        path: ['session', 'executionIds'],
      });
    }
  });

export const stopCompoundRunRequestSchema = z
  .object({ workspaceId: workspaceIdSchema, sessionId: uuidSchema })
  .strict();

export type CompoundRunConfiguration = z.infer<typeof compoundRunConfigurationSchema>;
export type SaveCompoundRunConfigurationRequest = z.infer<
  typeof saveCompoundRunConfigurationRequestSchema
>;
export type DeleteCompoundRunConfigurationRequest = z.infer<
  typeof deleteCompoundRunConfigurationRequestSchema
>;
export type ProposeCompoundRunRequest = z.infer<typeof proposeCompoundRunRequestSchema>;
export type ListCompoundRunSessionsRequest = z.infer<typeof listCompoundRunSessionsRequestSchema>;
export type CompoundRunSession = z.infer<typeof compoundRunSessionSchema>;
export type CompoundRunProposal = z.infer<typeof compoundRunProposalSchema>;
export type StopCompoundRunRequest = z.infer<typeof stopCompoundRunRequestSchema>;
