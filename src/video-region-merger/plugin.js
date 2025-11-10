/**
 * Video Region Merger Plugin
 *
 * This plugin allows merging video rectangle regions that share the same global_id.
 * It combines all temporal sequences from regions with matching global_id values,
 * creates a new merged region, and deletes the original regions.
 *
 * Usage:
 * - Annotate multiple video regions (tracks)
 * - Assign the same global_id to regions that represent the same person across different tracks
 * - Press Ctrl+M (or Cmd+M on Mac) to merge regions with matching global_id values
 */

async function initVideoRegionMerger() {
  // Wait for Label Studio Interface to be ready
  await LSI;

  // Add keyboard shortcut (Ctrl+M or Cmd+M) to trigger merge
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "m") {
      e.preventDefault();
      mergeRegionsByGlobalId();
    }
  });

  // Also add a custom button to the interface
  addMergeButton();
}

/**
 * Adds a "Merge Regions by Global ID" button to the interface
 */
function addMergeButton() {
  // Wait for the UI to be fully loaded
  setTimeout(() => {
    const toolbar = document.querySelector('.lsf-toolbar') ||
                    document.querySelector('[class*="toolbar"]') ||
                    document.querySelector('.lsf-sidepanels__wrapper');

    if (toolbar) {
      const button = document.createElement('button');
      button.textContent = 'Merge Regions by Global ID';
      button.className = 'lsf-button';
      button.style.cssText = 'margin: 10px; padding: 8px 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;';

      button.addEventListener('click', mergeRegionsByGlobalId);
      button.addEventListener('mouseenter', () => {
        button.style.background = '#0056b3';
      });
      button.addEventListener('mouseleave', () => {
        button.style.background = '#007bff';
      });

      toolbar.appendChild(button);
    }
  }, 1000);
}

/**
 * Main function to merge regions by their global_id
 */
function mergeRegionsByGlobalId() {
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
          if (globalId) {
            regionToGlobalId.set(region.id, globalId);
            console.log(`[Merge] Region ${region.id} has global_id: ${globalId}`);
          }
        }
      }
    });

    if (regionToGlobalId.size === 0) {
      Htx.showModal('No regions with global_id found. Please add global_id values to your regions first.', 'info');
      return;
    }

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
    });

    console.log('[Merge] Merge complete. Triggering UI update...');

    // Force multiple UI refresh mechanisms to ensure regions are redrawn
    // Method 1: Direct update
    annotation.updateObjects();

    // Method 2: Trigger a region list refresh
    if (annotation.regionStore) {
      annotation.regionStore.unselectAll();
    }

    // Method 3: History-based refresh
    if (annotation.history) {
      annotation.history.freeze();
      annotation.updateObjects();
      annotation.history.unfreeze();
    }

    // Method 4: Delayed refresh to ensure React/MobX state updates propagate
    setTimeout(() => {
      annotation.updateObjects();
      console.log('[Merge] Delayed UI refresh complete');
    }, 50);

    // Method 5: Final refresh to catch any stragglers
    setTimeout(() => {
      annotation.updateObjects();
      console.log('[Merge] Final UI refresh complete');
    }, 200);

    if (mergedCount > 0) {
      Htx.showModal(
        `Successfully merged ${totalRegionsProcessed} regions into ${mergedCount} merged region(s).`,
        'success'
      );
    } else {
      Htx.showModal('No regions with matching global_id found to merge.', 'info');
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
  const uniqueSequences = [];
  const seenFrames = new Set();

  allSequences.forEach(seq => {
    const frameKey = seq.frame !== undefined ? seq.frame : seq.time;
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

      // Add the global_id to the new merged region using a working template
      if (mergedResult) {
        try {
          // Find an existing global_id result from one of the source regions to use as template
          let templateGlobalIdResult = null;
          for (const region of regionsToMerge) {
            const globalIdRes = region.results?.find(r =>
              r.from_name?.name === 'global_id'
            );
            if (globalIdRes) {
              templateGlobalIdResult = globalIdRes;
              console.log(`[Merge] Using template from region ${region.id}:`, {
                from_name: globalIdRes.from_name?.name,
                to_name: globalIdRes.to_name?.name
              });
              break;
            }
          }

          if (templateGlobalIdResult) {
            // Use the exact same from_name and to_name objects that work
            const globalIdResult = annotation.createResult(
              {
                text: [globalId]
              },
              {},
              templateGlobalIdResult.from_name,  // Use working control object
              templateGlobalIdResult.to_name     // Use working video object
            );

            console.log(`[Merge] global_id result created:`, globalIdResult?.id);

            // Verify the result is in the merged region's results array
            const mergedRegion = annotation.regions.find(r =>
              r.results && r.results.some(res => res.id === mergedResult.id)
            );

            if (mergedRegion && globalIdResult) {
              const hasGlobalId = mergedRegion.results.some(r => r.id === globalIdResult.id);
              console.log(`[Merge] Merged region ${mergedRegion.id} has global_id result: ${hasGlobalId}`);

              if (!hasGlobalId) {
                console.log(`[Merge] Adding global_id result to merged region's results array`);
                mergedRegion.results.push(globalIdResult);
              }
            }
          } else {
            console.warn('[Merge] Could not find template global_id result from source regions');
          }
        } catch (err) {
          console.error('[Merge] Error adding global_id to merged region:', err);
          console.error('[Merge] Error details:', err.message, err.stack);
        }
      }

      // Delete all original regions (their results will be deleted automatically)
      console.log(`[Merge] Deleting ${regionsToMerge.length} original regions...`);

      // Unselect any selected regions first to avoid UI issues
      if (annotation.regionStore && annotation.regionStore.unselectAll) {
        annotation.regionStore.unselectAll();
      }

      regionsToMerge.forEach((region, index) => {
        console.log(`[Merge] Deleting region ${index + 1}/${regionsToMerge.length}: ${region.id}`);

        // Unselect this specific region if it's selected
        if (region.selected) {
          region.setSelected(false);
        }

        // Delete the region (its results will be automatically deleted)
        try {
          annotation.deleteRegion(region);
          console.log(`[Merge]   - Deleted region: ${region.id}`);
        } catch (err) {
          console.error(`[Merge]   - Error deleting region ${region.id}:`, err);
        }
      });

      console.log(`[Merge] Deletion complete. Current region count: ${annotation.regions.length}`);

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
