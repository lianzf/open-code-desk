import { ipcMain } from 'electron';
import {
  applyChangeSetRequestSchema,
  changeContentsRequestSchema,
  changeContentsSchema,
  changesChannels,
  changeSetIdRequestSchema,
  editChangeProposalRequestSchema,
  fileChangeSetListSchema,
  fileChangeSetSchema,
  listChangeSetsRequestSchema,
  reviewChangeRequestSchema,
  reviewManyChangesRequestSchema,
} from '@open-code-desk/ipc-contracts';

import type { FileChangeTransactionService } from '../changes/file-change-transaction.service';
import type { FileChangeAggregate } from '../changes/file-change.repository';
import type { FileChangeService } from '../changes/file-change.service';
import { assertTrustedIpcEvent, type TrustedRendererOptions } from './assert-trusted-event';

function publicAggregate(aggregate: FileChangeAggregate) {
  return {
    ...aggregate.changeSet,
    changes: aggregate.changes.map((change) => ({
      id: change.id,
      changeSetId: change.changeSetId,
      sequence: change.sequence,
      filePath: change.filePath,
      ...(change.destinationPath === undefined ? {} : { destinationPath: change.destinationPath }),
      operation: change.operation,
      ...(change.baselineHash === undefined ? {} : { baselineHash: change.baselineHash }),
      ...(change.proposedHash === undefined ? {} : { proposedHash: change.proposedHash }),
      ...(change.appliedHash === undefined ? {} : { appliedHash: change.appliedHash }),
      diff: change.diff,
      reviewDigest: change.reviewDigest,
      status: change.status,
      ...(change.error === undefined ? {} : { error: change.error }),
      createdAt: change.createdAt,
      updatedAt: change.updatedAt,
      ...(change.appliedAt === undefined ? {} : { appliedAt: change.appliedAt }),
      ...(change.rolledBackAt === undefined ? {} : { rolledBackAt: change.rolledBackAt }),
    })),
  };
}

export function registerChangesIpc(
  options: TrustedRendererOptions,
  service: FileChangeService,
  transactions: FileChangeTransactionService,
): void {
  ipcMain.handle(changesChannels.listForConversation, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = listChangeSetsRequestSchema.parse(untrustedInput);
    return fileChangeSetListSchema.parse(
      service.listForConversation(input.conversationId).map(publicAggregate),
    );
  });

  ipcMain.handle(changesChannels.get, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = changeSetIdRequestSchema.parse(untrustedInput);
    return fileChangeSetSchema.parse(publicAggregate(service.get(input.changeSetId)));
  });

  ipcMain.handle(changesChannels.getContents, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = changeContentsRequestSchema.parse(untrustedInput);
    return changeContentsSchema.parse(await service.getContents(input.changeId));
  });

  ipcMain.handle(changesChannels.review, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = reviewChangeRequestSchema.parse(untrustedInput);
    return fileChangeSetSchema.parse(
      publicAggregate(service.review(input.changeId, input.expectedReviewDigest, input.decision)),
    );
  });

  ipcMain.handle(changesChannels.reviewMany, (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = reviewManyChangesRequestSchema.parse(untrustedInput);
    return fileChangeSetSchema.parse(
      publicAggregate(service.reviewMany(input.changeSetId, input.entries, input.decision)),
    );
  });

  ipcMain.handle(changesChannels.editProposal, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = editChangeProposalRequestSchema.parse(untrustedInput);
    return fileChangeSetSchema.parse(
      publicAggregate(
        await service.editProposal(input.changeId, input.expectedReviewDigest, input.content),
      ),
    );
  });

  ipcMain.handle(changesChannels.apply, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = applyChangeSetRequestSchema.parse(untrustedInput);
    return fileChangeSetSchema.parse(
      publicAggregate(await transactions.apply(input.changeSetId, input.expectedApplyDigest)),
    );
  });

  ipcMain.handle(changesChannels.rollback, async (event, untrustedInput: unknown) => {
    assertTrustedIpcEvent(event, options);
    const input = applyChangeSetRequestSchema.parse(untrustedInput);
    return fileChangeSetSchema.parse(
      publicAggregate(await transactions.rollback(input.changeSetId, input.expectedApplyDigest)),
    );
  });
}

export function unregisterChangesIpc(): void {
  Object.values(changesChannels).forEach((channel) => ipcMain.removeHandler(channel));
}
