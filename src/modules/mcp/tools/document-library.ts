import "server-only";

import { getDocumentWorkspaceData } from "@/modules/documents/server/documents";

export async function searchDocumentLibraryForMcp(input: Record<string, unknown>) {
  const result = await getDocumentWorkspaceData({
    query: typeof input.q === "string" ? input.q : "",
    status: typeof input.status === "string" ? input.status : "active",
    folderId: typeof input.folderId === "string" ? input.folderId : undefined,
    allFolders: typeof input.folderId !== "string" || !input.folderId,
  });
  if (!result.allowed) throw new Error(`Document access denied: ${result.reason}.`);
  const data = result.data;

  return {
    summary: data.summary,
    folders: data.folders.map((folder) => ({
      id: folder.id,
      parentFolderId: folder.parentFolderId,
      name: folder.name,
      path: folder.path,
      classification: folder.classification,
      archivedAt: folder.archivedAt,
    })),
    documents: data.documents.map((document) => ({
      id: document.id,
      title: document.title,
      description: document.description,
      documentDate: document.documentDate,
      referenceCode: document.referenceCode,
      classification: document.classification,
      owner: { membershipId: document.ownerMembershipId, name: document.ownerName },
      folderId: document.folderId,
      folderPath: document.folderPath,
      category:
        document.categoryId && document.categoryName
          ? { id: document.categoryId, name: document.categoryName }
          : null,
      status: document.status,
      reviewDate: document.reviewDate,
      expiryDate: document.expiryDate,
      retentionUntil: document.retentionUntil,
      legalHold: document.legalHold,
      reviewState: document.reviewState,
      retentionState: document.retentionState,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      tags: document.tags.map((tag) => ({ id: tag.id, name: tag.name })),
      links: document.links.map((link) => ({
        id: link.id,
        type: link.entityType,
        entityId: link.entityId,
        label: link.label,
      })),
      versions: document.versions.map((version) => ({
        id: version.id,
        version: version.versionNumber,
        fileName: version.fileName,
        mimeType: version.mimeType,
        sizeBytes: version.sizeBytes,
        sha256: version.sha256,
        fileStatus: version.fileStatus,
        uploadedByName: version.uploadedByName,
        createdAt: version.createdAt,
      })),
      libraryUrl: document.folderId ? `/documents?folder=${document.folderId}` : "/documents",
    })),
  };
}
