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
    const results = annotation.results || [];

    if (regions.length === 0) {
      Htx.showModal('No regions found to merge.', 'info');
      return;
    }

    // Build a map of region_id -> global_id
    const regionToGlobalId = new Map();

    // Find all TextArea results with from_name="global_id"
    results.forEach(result => {
      if (result.type === 'textarea' &&
          result.from_name &&
          result.from_name.name === 'global_id' &&
          result.value &&
          result.value.text &&
          result.value.text[0]) {

        const globalId = result.value.text[0].trim();

        // For per-region results, parent_id links to the region
        if (result.parent_id && globalId) {
          regionToGlobalId.set(result.parent_id, globalId);
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

    // Track merge statistics
    let mergedCount = 0;
    let totalRegionsProcessed = 0;

    // For each global_id group with multiple regions, merge them
    globalIdToRegions.forEach((regionsGroup, globalId) => {
      if (regionsGroup.length > 1) {
        mergeRegions(regionsGroup, globalId, annotation);
        mergedCount++;
        totalRegionsProcessed += regionsGroup.length;
      }
    });

    // Update the annotation view
    annotation.updateObjects();

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
  // Collect all sequences from all regions
  const allSequences = [];
  const labels = regionsToMerge[0].labels || [];
  let videoObject = null;
  let fromName = null;

  regionsToMerge.forEach(region => {
    // VideoRectangle regions have a sequence property
    if (region.sequence && Array.isArray(region.sequence)) {
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

      // Add the global_id to the new merged region
      if (mergedResult) {
        // Find the global_id TextArea control
        const globalIdControl = annotation.names.get('global_id');

        if (globalIdControl) {
          // Create a TextArea result for the merged region
          annotation.createResult(
            {
              text: [globalId]
            },
            {},
            'global_id',
            videoObject,
            mergedResult
          );
        }
      }

      // Delete all original regions and their associated results
      regionsToMerge.forEach(region => {
        // Find and delete associated TextArea results
        const resultsToDelete = annotation.results.filter(r => r.parent_id === region.id);
        resultsToDelete.forEach(result => {
          annotation.deleteResult(result);
        });

        // Delete the region itself
        annotation.deleteRegion(region);
      });

    } catch (error) {
      console.error('Error creating merged region:', error);
      throw error;
    }
  }
}

// Initialize the plugin
initVideoRegionMerger();
