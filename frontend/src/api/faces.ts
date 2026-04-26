import { api } from './client';

export interface FaceAssignmentResponse {
  detection_id: string;
  identity_id: string | null;
  identity_score: number | null;
  assignment_source: string | null;
  is_reference: boolean;
}

export function getFaceCropUrl(detectionId: string): string {
  return `/api/v1/faces/crops/${detectionId}`;
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
