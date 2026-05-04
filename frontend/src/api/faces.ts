import { api } from './client';

export interface FaceAssignmentResponse {
  detection_id: string;
  identity_id: string | null;
  identity_score: number | null;
  assignment_source: string | null;
  is_reference: boolean;
}

export interface ImportBatchFaceClusterDetection {
  id: string;
  asset_id: string;
  asset_title: string | null;
  crop_url: string | null;
  confidence: number | null;
  quality_score: number | null;
  review_required: boolean;
  review_state: string | null;
}

export interface ImportBatchFaceCluster {
  identity_id: string;
  person_id: string | null;
  person_name: string | null;
  cover_url: string | null;
  samples_count: number;
  detections_count: number;
  review_required_count: number;
  detections: ImportBatchFaceClusterDetection[];
}

export interface IdentityAssignmentResponse {
  identity_id: string;
  person_id: string | null;
  person_name: string | null;
  review_required_count: number;
}

export function getFaceCropUrl(detectionId: string): string {
  return `/api/v1/faces/crops/${detectionId}`;
}

export async function getImportBatchFaceIdentityClusters(
  batchId: string,
): Promise<ImportBatchFaceCluster[]> {
  const { data } = await api.get<ImportBatchFaceCluster[]>(
    `/faces/import-batches/${batchId}/identity-clusters`,
  );
  return data;
}

export async function assignFacePerson(
  detectionId: string,
  personId: string,
): Promise<FaceAssignmentResponse> {
  const { data } = await api.post<FaceAssignmentResponse>(
    `/faces/${detectionId}/assign-person`,
    { person_id: personId },
  );
  return data;
}

export async function assignFaceNewPerson(
  detectionId: string,
  name: string,
): Promise<FaceAssignmentResponse> {
  const { data } = await api.post<FaceAssignmentResponse>(
    `/faces/${detectionId}/assign-new-person`,
    { name },
  );
  return data;
}

export async function unassignFacePerson(
  detectionId: string,
): Promise<FaceAssignmentResponse> {
  const { data } = await api.post<FaceAssignmentResponse>(
    `/faces/${detectionId}/unassign`,
  );
  return data;
}

export async function assignFaceIdentityPerson(
  batchId: string,
  identityId: string,
  personId: string,
): Promise<IdentityAssignmentResponse> {
  const { data } = await api.post<IdentityAssignmentResponse>(
    `/faces/import-batches/${batchId}/identity-clusters/${identityId}/assign-person`,
    { person_id: personId },
  );
  return data;
}

export async function assignFaceIdentityNewPerson(
  batchId: string,
  identityId: string,
  name: string,
): Promise<IdentityAssignmentResponse> {
  const { data } = await api.post<IdentityAssignmentResponse>(
    `/faces/import-batches/${batchId}/identity-clusters/${identityId}/assign-new-person`,
    { name },
  );
  return data;
}

export async function unassignFaceIdentityPerson(
  batchId: string,
  identityId: string,
): Promise<IdentityAssignmentResponse> {
  const { data } = await api.post<IdentityAssignmentResponse>(
    `/faces/import-batches/${batchId}/identity-clusters/${identityId}/unassign`,
  );
  return data;
}
