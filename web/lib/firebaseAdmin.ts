import "server-only";

import { cert, getApp, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

/**
 * Server-side Firestore, used only by the approval route to append the
 * approval.granted event. Credentials come from Application Default Credentials
 * (gcloud auth application-default login locally, or the Cloud Run service account
 * in production). No key file is committed.
 */
function adminApp() {
  if (getApps().length) return getApp();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  return initializeApp({
    credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? cert(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      : applicationDefault(),
    projectId,
  });
}

export function adminFirestore() {
  return getFirestore(adminApp());
}

export { FieldValue };
