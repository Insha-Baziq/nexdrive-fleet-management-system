const deploymentVerification = process.env.NEXDRIVE_VERIFY_DEPLOYMENT === "1";

// Vercel Functions reject request bodies above 4.5 MiB before NexDrive sees them.
// Local suites exercise the product's full 15 MiB boundary; deployment suites
// use a 3 MiB valid boundary so multipart overhead remains below the platform cap.
export const maxTestUploadBytes = deploymentVerification ? 3 * 1024 * 1024 : 15 * 1024 * 1024;

export function isOversizedUploadRejected(status) {
  return status === 400 || (deploymentVerification && status === 413);
}
