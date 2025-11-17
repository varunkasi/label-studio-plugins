/**
 * Video Region Merger Plugin
 *
 * This plugin allows merging video rectangle regions that share the same global_id.
 * It combines all temporal sequences from regions with matching global_id values,
 * creates a new merged region, and deletes the original regions.
 *
 * Usage:
 * - Annotate multiple video regions (tracks)
 * - Assign the same integer global_id to regions that represent the same object (e.g., 1, 2, 3)
 * - Press Ctrl+M (or Cmd+M on Mac) to merge regions with matching global_id values
 * - Regions without global_id or with invalid values are silently skipped (no popups)
 *
 * Validation:
 * - global_id must be a positive integer (e.g., "1", "2", "100")
 * - Empty or non-integer values are ignored during merge
 * - Only regions with matching integer global_id values are merged
 */

// State management
let mergeInProgress = false;
let keydownHandler = null;

async function initVideoRegionMerger() {
  // Wait for Label Studio Interface to be ready
  await LSI;

  // Remove any existing listener to prevent duplicates
  if (keydownHandler) {
    window.removeEventListener("keydown", keydownHandler);
  }

  // Add keyboard shortcut (Ctrl+M or Cmd+M) to trigger merge
  keydownHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "m") {
      e.preventDefault();

      // Debouncing: prevent multiple simultaneous merges
      if (!mergeInProgress) {
        mergeRegionsByGlobalId();
      } else {
        console.log('[Merge] Merge already in progress, ignoring keypress');
      }
    }
  };

  window.addEventListener("keydown", keydownHandler);
}

/**
 * Cleanup function to remove event listeners (call when plugin is destroyed)
 */
function cleanupVideoRegionMerger() {
  if (keydownHandler) {
    window.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  }
}

/**
 * Main function to merge regions by their global_id
 */
function mergeRegionsByGlobalId() {
  try {
    // Set merge in progress flag to prevent concurrent merges
    mergeInProgress = true;

    // Force blur on active element to commit any pending TextArea changes
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      console.log('[Merge] Blurring active element to commit pending changes');
      document.activeElement.blur();
    }

    // Use requestAnimationFrame to wait for the next browser render cycle,
    // then add a minimal delay for Label Studio's internal state updates.
    // This is more reliable than a fixed arbitrary delay as it ensures
    // the blur event and DOM updates have been processed.
    requestAnimationFrame(() => {
      // Additional 50ms delay for Label Studio's MobX state to update
      // (reduced from 150ms for better responsiveness)
      setTimeout(() => {
        try {
          performMerge();
        } finally {
          // Always reset the flag, even if merge fails
          mergeInProgress = false;
        }
      }, 50);
    });
  } catch (error) {
    mergeInProgress = false;
    console.error('Error during region merge:', error);
    Htx.showModal(`Error merging regions: ${error.message}`, 'error');
  }
}

/**
 * Finds a global_id result template from source regions
 * @param {Array} regionsToMerge - Source regions to search
 * @returns {Object|null} Template global_id result or null if not found
 */
function findGlobalIdTemplate(regionsToMerge) {
  for (const region of regionsToMerge) {
    const globalIdRes = region.results?.find(r =>
      r.from_name?.name === 'global_id'
    );
    if (globalIdRes) {
      console.log(`[Merge] Using template from region ${region.id}:`, {
        from_name: globalIdRes.from_name?.name,
        to_name: globalIdRes.to_name?.name
      });
      return globalIdRes;
    }
  }
  console.warn('[Merge] Could not find template global_id result from source regions');
  return null;
}

/**
 * Attaches a global_id to the merged region
 * @param {Object} mergedResult - The newly created merged result
 * @param {string} globalId - The global_id value to attach
 * @param {Object} templateGlobalIdResult - Template to use for structure
 * @param {Object} annotation - The annotation object
 * @returns {boolean} True if successful, false otherwise
 */
function attachGlobalIdToRegion(mergedResult, globalId, templateGlobalIdResult, annotation) {
  if (!mergedResult) {
    console.error('[Merge] No merged result provided');
    return false;
  }

  if (!templateGlobalIdResult) {
    console.warn('[Merge] No template provided for global_id');
    return false;
  }

  // Find the merged region by ID (region ID matches result ID in Label Studio)
  console.log(`[Merge] Looking for merged region with id:`, mergedResult.id);
  console.log(`[Merge] Current annotation.regions count:`, annotation.regions.length);

  const mergedRegion = annotation.regions.find(r => r.id === mergedResult.id);

  if (!mergedRegion) {
    console.warn(`[Merge] Could not find merged region with id: ${mergedResult.id}`);
    return false;
  }

  console.log(`[Merge] Found merged region:`, mergedRegion.id);
  console.log(`[Merge] Merged region results count:`, mergedRegion.results?.length);

  // Check if global_id already exists
  const hasGlobalId = mergedRegion.results.some(r =>
    r.from_name?.name === 'global_id'
  );
  console.log(`[Merge] Merged region ${mergedRegion.id} has global_id result: ${hasGlobalId}`);

  if (!hasGlobalId) {
    // Pass plain object descriptor directly to addResult
    console.log(`[Merge] Adding global_id result using addResult with plain object`);
    mergedRegion.addResult({
      type: 'textarea',
      from_name: templateGlobalIdResult.from_name,
      to_name: templateGlobalIdResult.to_name,
      value: { text: [globalId] }
    });
    console.log(`[Merge] After addResult, merged region results count:`, mergedRegion.results.length);
    return true;
  }

  return false;
}

/**
 * Deletes the source regions after merge
 * @param {Array} regionsToMerge - Regions to delete
 * @param {Object} annotation - The annotation object
 */
function deleteSourceRegions(regionsToMerge, annotation) {
  console.log(`[Merge] Before deletion - region count: ${annotation.regions.length}`);
  console.log(`[Merge] Deleting ${regionsToMerge.length} original regions...`);

  // Unselect any selected regions first to avoid UI issues
  if (annotation.regionStore && annotation.regionStore.unselectAll) {
    annotation.regionStore.unselectAll();
  }

  regionsToMerge.forEach((region, index) => {
    console.log(`[Merge] Deleting region ${index + 1}/${regionsToMerge.length}: ${region.id}`);
    console.log(`[Merge]   - Count before delete: ${annotation.regions.length}`);

    // Unselect this specific region if it's selected
    if (region.selected) {
      region.setSelected(false);
    }

    // Delete the region (its results will be automatically deleted)
    try {
      annotation.deleteRegion(region);
      console.log(`[Merge]   - Deleted region: ${region.id}`);
      console.log(`[Merge]   - Count after delete: ${annotation.regions.length}`);
    } catch (err) {
      console.error(`[Merge]   - Error deleting region ${region.id}:`, err);
    }
  });

  console.log(`[Merge] Deletion complete. Final region count: ${annotation.regions.length}`);
  console.log(`[Merge] Remaining region IDs:`, annotation.regions.map(r => r.id));
}

/**
 * Refreshes the Label Studio UI to reflect region changes
 * Uses multiple strategies to ensure all UI components update correctly
 *
 * @param {Object} annotation - The annotation object
 */
function refreshAnnotationUI(annotation) {
  // Step 1: Immediate update to trigger initial render
  annotation.updateObjects();

  // Step 2: Unselect all regions to clear UI state
  // This ensures the region list and canvas are in sync
  if (annotation.regionStore) {
    annotation.regionStore.unselectAll();
  }

  // Step 3: History-based refresh to ensure undo/redo stack is consistent
  // Freezing history prevents creating undo steps during internal updates
  if (annotation.history) {
    annotation.history.freeze();
    annotation.updateObjects();
    annotation.history.unfreeze();
  }

  // Step 4: Delayed refresh to allow MobX reactions to propagate
  // React re-renders triggered by MobX may take 1-2 animation frames
  setTimeout(() => {
    annotation.updateObjects();
    console.log('[Merge] First delayed UI refresh complete');
  }, 50);

  // Step 5: Final refresh as a safety net for any stragglers
  // Some UI components (e.g., timeline) may update on their own schedule
  setTimeout(() => {
    annotation.updateObjects();
    console.log('[Merge] Final UI refresh complete');
  }, 200);
}

/**
 * Performs the actual merge operation after pending changes are committed
 */
function performMerge() {
  try {
    const annotation = Htx.annotationStore.selected;

    if (!annotation) {
      Htx.showModal('No annotation selected. Please create annotations first.', 'error');
      return;
    }

    const regions = annotation.regions || [];

    console.log('[Merge] Starting merge process...');
    console.log('[Merge] Total regions:', regions.length);

    if (regions.length === 0) {
      Htx.showModal('No regions found to merge.', 'info');
      return;
    }

    // Build a map of region_id -> global_id
    // Only include regions with valid integer global_id values
    const regionToGlobalId = new Map();

    // For each region, find its associated global_id from its results array
    regions.forEach(region => {
      if (region.results && Array.isArray(region.results)) {
        const globalIdResult = region.results.find(r =>
          r.type === 'textarea' &&
          r.from_name &&
          r.from_name.name === 'global_id' &&
          r.value &&
          r.value.text &&
          r.value.text[0]
        );

        if (globalIdResult) {
          const globalId = globalIdResult.value.text[0].trim();

          // Validate: global_id must be a positive integer (excluding 0)
          // Regex: ^[1-9]\d*$ matches integers starting with 1-9
          if (globalId && /^[1-9]\d*$/.test(globalId)) {
            regionToGlobalId.set(region.id, globalId);
            console.log(`[Merge] Region ${region.id} has valid positive integer global_id: ${globalId}`);
          } else if (globalId) {
            console.log(`[Merge] Region ${region.id} has invalid global_id (not a positive integer): ${globalId}`);
          }
        }
      }
    });

    // Silently skip merge if no valid regions found
    // This prevents unexpected popups when regions don't have global_id set
    if (regionToGlobalId.size === 0) {
      console.log('[Merge] No regions with valid integer global_id found. Skipping merge.');
      return;
    }

    console.log(`[Merge] Found ${regionToGlobalId.size} region(s) with valid integer global_id`);
    console.log(`[Merge] Skipping ${regions.length - regionToGlobalId.size} region(s) without valid global_id`);

    // Group regions by global_id
    const globalIdToRegions = new Map();

    regions.forEach(region => {
      const globalId = regionToGlobalId.get(region.id);
      if (globalId) {
        if (!globalIdToRegions.has(globalId)) {
          globalIdToRegions.set(globalId, []);
        }
        globalIdToRegions.get(globalId).push(region);
      }
    });

    console.log('[Merge] Groups found:', globalIdToRegions.size);

    // Track merge statistics
    let mergedCount = 0;
    let totalRegionsProcessed = 0;

    // For each global_id group with multiple regions, merge them
    globalIdToRegions.forEach((regionsGroup, globalId) => {
      if (regionsGroup.length > 1) {
        console.log(`[Merge] Merging ${regionsGroup.length} regions for global_id: ${globalId}`);
        mergeRegions(regionsGroup, globalId, annotation);
        mergedCount++;
        totalRegionsProcessed += regionsGroup.length;
      }
      // Silently skip single regions - no logging needed
    });

    console.log('[Merge] Merge complete. Triggering UI update...');

    // Refresh the UI using a multi-step approach
    // Label Studio uses MobX for reactive state management, and updates may not
    // propagate immediately. This multi-step refresh ensures consistency across
    // all UI components (region list, canvas, timeline, etc.)
    refreshAnnotationUI(annotation);

    // Show success message only when actual merges happened
    if (mergedCount > 0) {
      Htx.showModal(
        `Successfully merged ${totalRegionsProcessed} regions into ${mergedCount} merged region(s).`,
        'success'
      );
    } else {
      // No merges happened - silently skip (no popup)
      // This prevents unexpected popups when regions have unique or no global_id values
      console.log('[Merge] No matching global_id values found to merge.');
    }

  } catch (error) {
    console.error('Error during region merge:', error);
    Htx.showModal(`Error merging regions: ${error.message}`, 'error');
  }
}

/**
 * Merges multiple regions with the same global_id into a single region
 *
 * @param {Array} regionsToMerge - Array of regions to merge
 * @param {string} globalId - The common global_id value
 * @param {Object} annotation - The annotation object
 */
function mergeRegions(regionsToMerge, globalId, annotation) {
  // Safety check: ensure we have regions to merge
  if (!regionsToMerge || regionsToMerge.length === 0) {
    console.error('[Merge] No regions provided to merge');
    return;
  }

  console.log(`[Merge] Processing merge for global_id: ${globalId}`);
  console.log(`[Merge] Regions to merge:`, regionsToMerge.map(r => ({ id: r.id, frames: r.sequence?.length })));

  // Collect all sequences from all regions
  const allSequences = [];
  const labels = regionsToMerge[0].labels || [];
  let videoObject = null;
  let fromName = null;

  regionsToMerge.forEach(region => {
    // VideoRectangle regions have a sequence property
    if (region.sequence && Array.isArray(region.sequence)) {
      console.log(`[Merge] Region ${region.id} has ${region.sequence.length} keyframes`);
      allSequences.push(...region.sequence);
    }

    // Store reference to video object and from_name for creating new region
    if (!videoObject && region.object) {
      videoObject = region.object;
    }
    if (!fromName && region.labeling) {
      fromName = region.labeling.from_name;
    }
  });

  console.log(`[Merge] Total keyframes collected: ${allSequences.length}`);

  // Sort sequences by frame/time (assuming each sequence item has a 'frame' or 'time' property)
  allSequences.sort((a, b) => {
    if (a.frame !== undefined) return a.frame - b.frame;
    if (a.time !== undefined) return a.time - b.time;
    return 0;
  });

  // Remove duplicate keyframes (same frame number)
  // Use proper property existence check to handle frame=0 and time=0 correctly
  const uniqueSequences = [];
  const seenFrames = new Set();

  allSequences.forEach(seq => {
    // Create a composite key that distinguishes between frame-based and time-based sequences
    // This prevents collisions when frame=5 and time=5 are different semantic values
    let frameKey;
    if ('frame' in seq) {
      frameKey = `frame:${seq.frame}`;
    } else if ('time' in seq) {
      frameKey = `time:${seq.time}`;
    } else {
      // Fallback: use object reference if neither frame nor time exists
      frameKey = `ref:${uniqueSequences.length}`;
    }

    if (!seenFrames.has(frameKey)) {
      seenFrames.add(frameKey);
      uniqueSequences.push(seq);
    }
  });

  console.log(`[Merge] Unique keyframes after deduplication: ${uniqueSequences.length}`);

  // Create a new merged region
  // For VideoRectangle, we need to create a result with the merged sequence
  if (videoObject && fromName) {
    try {
      // Calculate duration from sequence
      let duration = 0;
      if (uniqueSequences.length > 0) {
        const firstFrame = uniqueSequences[0].frame || uniqueSequences[0].time || 0;
        const lastFrame = uniqueSequences[uniqueSequences.length - 1].frame ||
                         uniqueSequences[uniqueSequences.length - 1].time || 0;
        const framerate = videoObject.framerate || 24;
        duration = (lastFrame - firstFrame) / framerate;
      }

      console.log(`[Merge] Creating new merged region with duration: ${duration}s`);

      // Create the merged result
      const mergedResult = annotation.createResult(
        {
          sequence: uniqueSequences,
          duration: duration,
        },
        {
          labels: labels,
        },
        fromName,
        videoObject
      );

      console.log(`[Merge] Merged result created:`, mergedResult?.id);

      // Add the global_id to the new merged region
      if (mergedResult) {
        try {
          const templateGlobalIdResult = findGlobalIdTemplate(regionsToMerge);
          if (templateGlobalIdResult) {
            attachGlobalIdToRegion(mergedResult, globalId, templateGlobalIdResult, annotation);
          }
        } catch (err) {
          console.error('[Merge] Error adding global_id to merged region:', err);
          console.error('[Merge] Error details:', err.message, err.stack);
        }
      }

      // Delete all original regions (their results will be deleted automatically)
      deleteSourceRegions(regionsToMerge, annotation);

    } catch (error) {
      console.error('[Merge] Error creating merged region:', error);
      // Don't throw - let the merge continue and try to delete regions anyway
    }
  } else {
    console.error('[Merge] Missing videoObject or fromName, cannot create merged region');
  }
}

// Initialize the plugin
initVideoRegionMerger();
