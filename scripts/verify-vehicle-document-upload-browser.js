(() => {
  const existing = document.getElementById("nexdrive-document-browser-check");
  existing?.remove();

  const vehicleFromPath = location.pathname.match(/^\/vehicles\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] ?? "";
  const panel = document.createElement("section");
  panel.id = "nexdrive-document-browser-check";
  panel.setAttribute("aria-label", "NexDrive vehicle document browser check");
  panel.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:min(420px,calc(100vw - 32px));padding:16px;border:1px solid #a3a3a3;border-radius:12px;background:#fff;color:#171717;box-shadow:0 12px 40px #0003;font:14px/1.45 system-ui,sans-serif";
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <strong>Vehicle document browser check</strong>
      <button type="button" data-close aria-label="Close" style="border:0;background:transparent;font-size:20px;cursor:pointer">×</button>
    </div>
    <label style="display:block;margin-top:12px">Controlled test vehicle ID
      <input data-vehicle value="${vehicleFromPath}" autocomplete="off" style="display:block;box-sizing:border-box;width:100%;margin-top:4px;padding:8px;border:1px solid #aaa;border-radius:6px">
    </label>
    <label style="display:block;margin-top:10px">Test document name
      <input data-name value="QA browser upload" maxlength="120" style="display:block;box-sizing:border-box;width:100%;margin-top:4px;padding:8px;border:1px solid #aaa;border-radius:6px">
    </label>
    <label style="display:block;margin-top:10px">Category
      <select data-category style="display:block;width:100%;margin-top:4px;padding:8px;border:1px solid #aaa;border-radius:6px">
        <option value="registration">Registration</option>
        <option value="inspection">Inspection</option>
        <option value="insurance">Insurance</option>
        <option value="rental_agreement">Rental agreement</option>
        <option value="other">Other</option>
      </select>
    </label>
    <label style="display:block;margin-top:10px">JPG, PNG, or PDF test file (15 MB max)
      <input data-file type="file" accept=".jpg,.jpeg,.png,.pdf" style="display:block;width:100%;margin-top:4px">
    </label>
    <p style="margin:10px 0 0;color:#525252;font-size:12px">Creates a staff-only document on this controlled vehicle. The completion API must verify it before it becomes visible.</p>
    <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
      <button type="button" data-run style="padding:8px 12px;border:0;border-radius:6px;background:#176957;color:white;font-weight:600;cursor:pointer">Run check</button>
      <span data-status role="status" style="min-width:0;overflow-wrap:anywhere;color:#404040"></span>
    </div>`;
  document.body.append(panel);

  const button = panel.querySelector("[data-run]");
  const status = panel.querySelector("[data-status]");
  panel.querySelector("[data-close]").addEventListener("click", () => panel.remove());

  button.addEventListener("click", async () => {
    const vehicleId = panel.querySelector("[data-vehicle]").value.trim();
    const name = panel.querySelector("[data-name]").value.trim();
    const category = panel.querySelector("[data-category]").value;
    const file = panel.querySelector("[data-file]").files?.[0];
    if (!/^[0-9a-f-]{36}$/i.test(vehicleId) || !name || !file) {
      status.textContent = "Enter a valid vehicle ID and name, then choose a test file.";
      return;
    }
    if (file.size < 1 || file.size > 15 * 1024 * 1024) {
      status.textContent = "The test file must be between 1 byte and 15 MB.";
      return;
    }

    button.disabled = true;
    let stage = "Preparing upload";
    try {
      status.textContent = `${stage}…`;
      const preparedResponse = await fetch(`/api/vehicles/${vehicleId}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          expiryDate: null,
          visibleToDriver: false,
          fileName: file.name,
          fileSize: file.size,
        }),
      });
      if (!preparedResponse.ok) throw new Error("The authenticated initiate request failed.");
      const prepared = await preparedResponse.json();
      const upload = prepared.upload;

      stage = "Uploading to private storage";
      status.textContent = `${stage}…`;
      const form = new FormData();
      for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
      form.append("file", file);
      const storageResponse = await fetch(upload.uploadUrl, {
        method: "POST",
        body: form,
        mode: "no-cors",
      });

      stage = "Verifying the stored file";
      status.textContent = `${stage}…`;
      const completeResponse = await fetch(`/api/vehicles/${vehicleId}/documents/${upload.id}/complete`, { method: "POST" });
      if (!completeResponse.ok) throw new Error("The server could not verify the stored file.");
      await completeResponse.json();

      const listResponse = await fetch(`/api/vehicles/${vehicleId}/documents`, { cache: "no-store" });
      if (!listResponse.ok) throw new Error("The authorized document list could not be reloaded.");
      const listed = (await listResponse.json()).documents.some((item) => item.id === upload.id && item.category === category);
      if (!listed) throw new Error("The uploaded document was not listed after completion.");

      const contentResponse = await fetch(`/api/vehicles/${vehicleId}/documents/${upload.id}/content`);
      if (!contentResponse.ok) throw new Error("The private document content could not be opened.");
      const bytes = new Uint8Array(await contentResponse.arrayBuffer());
      if (!bytes.length) throw new Error("The opened private document is empty.");

      status.textContent = `Passed. Initiate ${preparedResponse.status}, storage response ${storageResponse.type}, complete ${completeResponse.status}, listed after reload request, content ${contentResponse.status}. Document ID: ${upload.id}`;
      status.style.color = "#176957";
    } catch (error) {
      status.textContent = `${stage} failed. ${error instanceof Error ? error.message : "Check the browser Network panel."}`;
      status.style.color = "#b42318";
    } finally {
      button.disabled = false;
    }
  });

  return "Browser check panel added. Use only a controlled QA account and vehicle; remove the test record and stored object after verification.";
})();
