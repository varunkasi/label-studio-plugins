/**
 * Video Region Merger Plugin
 *
 * This plugin merges video regions that share the same global_id.
 * It operates quietly, only showing modals for successful merges or real errors.
 */

/**
 * Main merge function - merges regions with matching integer global_id values
 */
function performMerge() {
  const annotation = Htx.annotationStore.selected;

  // Silent early return if no annotation is selected
  if (!annotation) {
    console.log("[Merge] No annotation selected; aborting merge.");
    return;
  }

  const regions = annotation.regions || [];

  // Silent early return if no regions exist
  if (regions.length === 0) {
    console.log("[Merge] No regions in current annotation; aborting merge.");
    return;
  }

  try {
    // Build a map of region.id -> global_id (integer-only)
    const regionToGlobalId = new Map();

    for (const region of regions) {
      if (!Array.isArray(region.results)) continue;

      const globalIdResult = region.results.find(
        (r) => r.type === "textarea" && r.from_name?.name === "global_id" && r.value?.text && r.value.text[0] != null,
      );

      if (!globalIdResult) continue;

      const raw = String(globalIdResult.value.text[0]).trim();
      const isIntegerId = /^[0-9]+$/.test(raw);
      if (!isIntegerId) {
        console.log(`[Merge] Ignoring non-integer or empty global_id for region ${region.id}: "${raw}"`);
        continue;
      }

      regionToGlobalId.set(region.id, raw);
      console.log(`[Merge] Region ${region.id} has integer global_id: ${raw}`);
    }

    // Silent early return if no valid global_ids found
    if (regionToGlobalId.size === 0) {
      console.log("[Merge] No regions with valid global_id; aborting merge silently.");
      return;
    }

    // Group regions by their global_id
    const globalIdToRegions = new Map();
    for (const [regionId, globalId] of regionToGlobalId.entries()) {
      const region = regions.find((r) => r.id === regionId);
      if (!region) continue;

      if (!globalIdToRegions.has(globalId)) {
        globalIdToRegions.set(globalId, []);
      }
      globalIdToRegions.get(globalId).push(region);
    }

    // Merge regions for each global_id group that has more than one region
    let mergedCount = 0;
    let totalRegionsProcessed = 0;

    for (const [globalId, groupRegions] of globalIdToRegions.entries()) {
      if (groupRegions.length < 2) {
        console.log(`[Merge] global_id ${globalId} has only 1 region; skipping merge.`);
        continue;
      }

      console.log(`[Merge] Merging ${groupRegions.length} regions with global_id: ${globalId}`);

      // Sort regions by start time to maintain chronological order
      groupRegions.sort((a, b) => {
        const aStart = a.sequence?.[0]?.time || 0;
        const bStart = b.sequence?.[0]?.time || 0;
        return aStart - bStart;
      });

      // Collect all sequences from all regions in this group
      const allSequences = [];
      for (const region of groupRegions) {
        if (region.sequence && Array.isArray(region.sequence)) {
          allSequences.push(...region.sequence);
        }
      }

      // Sort all sequences by time
      allSequences.sort((a, b) => (a.time || 0) - (b.time || 0));

      // Use the first region as the base for the merged region
      const baseRegion = groupRegions[0];

      // Create the merged region with combined sequences
      const mergedRegionData = {
        type: baseRegion.type,
        object: baseRegion.object,
        from_name: baseRegion.labeling,
        sequence: allSequences,
      };

      // Copy labels from the base region
      if (baseRegion.labels && baseRegion.labels.length > 0) {
        mergedRegionData.labels = baseRegion.labels;
      }

      // Create the new merged region
      const mergedRegion = annotation.createResult(
        mergedRegionData,
        { labels: baseRegion.labels || [] },
        baseRegion.labeling.from_name,
        baseRegion.object,
      );

      // Copy the global_id to the merged region
      if (mergedRegion?.results) {
        const globalIdResultCopy = mergedRegion.results.find(
          (r) => r.type === "textarea" && r.from_name?.name === "global_id",
        );

        if (globalIdResultCopy) {
          globalIdResultCopy.value.text = [globalId];
        }
      }

      // Delete the original regions
      for (const region of groupRegions) {
        annotation.deleteRegion(region);
      }

      totalRegionsProcessed += groupRegions.length;
      mergedCount++;

      console.log(`[Merge] Created merged region for global_id ${globalId} from ${groupRegions.length} regions`);
    }

    // Update the UI
    annotation.updateObjects();

    // Show success modal only if regions were actually merged
    if (mergedCount > 0) {
      Htx.showModal(
        `Successfully merged ${totalRegionsProcessed} regions into ${mergedCount} merged region(s).`,
        "success",
      );
    } else {
      console.log("[Merge] No regions with matching global_id found to merge.");
    }
  } catch (error) {
    // Show modal for real errors
    console.error("[Merge] Error during merge operation:", error);
    Htx.showModal(`Error during merge: ${error.message}`, "error");
  }
}

// Register the merge button in the UI
LSI.on("regionMenuItems", (items, region) => {
  items.push({
    key: "merge-regions",
    label: "Merge Regions by Global ID",
    onClick: () => {
      performMerge();
    },
  });

  return items;
});

// Also make the function available globally for manual invocation
window.performMerge = performMerge;
