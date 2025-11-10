# Video Region Merger by Global ID

A Label Studio plugin for merging video rectangle regions that share the same `global_id` value, designed for person tracking and re-identification tasks.

## Overview

This plugin enables you to:
- Track the same person across multiple video segments/tracks
- Merge multiple region annotations into a single unified track
- Automatically combine temporal sequences based on a shared global identifier
- Clean up redundant regions after merging

## Use Case

In person tracking and re-identification workflows, you might create multiple separate tracks for the same person:
- When they temporarily leave the frame
- When occlusions break automatic tracking
- When manually correcting auto-generated tracks
- When the same person appears in different scenes

This plugin allows you to annotate each segment separately with a unique `global_id` (e.g., "P000123"), then merge all segments into a single comprehensive track.

## Features

- **Keyboard Shortcut**: Press `Ctrl+M` (Windows/Linux) or `Cmd+M` (Mac) to merge regions
- **Smart Merging**: Combines all temporal sequences from regions with matching `global_id` values
- **Automatic Cleanup**: Deletes original regions after successful merge
- **Frame Deduplication**: Removes duplicate keyframes when merging sequences
- **Success Feedback**: Shows confirmation with statistics about merged regions

## How It Works

1. **Annotate Video Regions**: Create video rectangle annotations for person tracking
2. **Assign Global IDs**: For each track/region, enter the same `global_id` for the same person (e.g., "P000123")
3. **Trigger Merge**: Press `Ctrl+M` (Windows/Linux) or `Cmd+M` (Mac)
4. **Review Results**: The plugin will:
   - Group all regions by their `global_id`
   - Merge sequences from each group into a single region
   - Assign the common `global_id` to the merged region
   - Delete all original regions
   - Display a success message with merge statistics

## Configuration

### view.xml

The plugin works with the following Label Studio configuration:

```xml
<View>
  <Video name="video" value="$video" framerate="$fps" timelineHeight="240" height="600" muted="false"/>

  <VideoRectangle
    name="box"
    toName="video"
    smart="true"
  />

  <Labels name="person" toName="video">
    <Label value="Person" background="green"/>
  </Labels>

  <View visibleWhen="region-selected">
    <Header size="4" value="ReID Annotation (per track)" />
    <TextArea name="global_id" toName="video" perRegion="true" maxSubmissions="1" rows="1" placeholder="Enter Global ID (e.g., P000123)" />
    <TextArea name="reid_notes" toName="video" perRegion="true" placeholder="Notes about identity, accessories, gait, etc." />
  </View>
</View>
```

### data.json

Example data format:

```json
{
  "data": {
    "video": "https://example.com/path/to/video.mp4",
    "fps": 30
  }
}
```

## Workflow Example

1. **Initial Annotations**:
   - Region 1: Frames 0-100, global_id = "P000123"
   - Region 2: Frames 150-250, global_id = "P000123"
   - Region 3: Frames 0-50, global_id = "P000456"

2. **After Merge**:
   - Merged Region 1: Frames 0-250 (combined from Region 1 & 2), global_id = "P000123"
   - Region 3: Frames 0-50, global_id = "P000456" (unchanged, no duplicates)

## Technical Details

- **Region Type**: Works with `VideoRectangle` annotations
- **Sequence Merging**: Combines keyframe sequences and sorts by frame number
- **Duplicate Handling**: Automatically removes duplicate keyframes
- **Duration Calculation**: Recalculates duration based on merged sequence
- **Label Preservation**: Maintains labels from the original regions

## Limitations

- Only merges regions that have a `global_id` value assigned
- Requires at least 2 regions with the same `global_id` to perform a merge
- Does not support undoing merge operations (use Label Studio's annotation history)
- Works specifically with VideoRectangle regions

## Troubleshooting

**No regions merged?**
- Ensure you've assigned `global_id` values to your regions
- Check that multiple regions share the exact same `global_id` (case-sensitive)
- Verify you have selected an annotation
- Open browser console (F12) and look for `[Merge]` log messages to see what's happening

**Merge not working as expected?**
- Check browser console for error messages
- Verify your Label Studio configuration matches the required schema
- Ensure the `global_id` TextArea is configured with `perRegion="true"`

**UI not updating after merge?**
- The plugin includes multiple UI refresh mechanisms
- Check browser console for `[Merge]` logs to confirm regions were actually merged
- If regions are merged in the backend but UI doesn't update, try:
  - Refreshing the page (your annotations are saved)
  - Navigating to another task and back
  - Report this as a bug with console logs

## Debugging

The plugin includes comprehensive logging. Open your browser console (F12) to see detailed merge information:

```
[Merge] Starting merge process...
[Merge] Total regions: 3
[Merge] Region abc123 has global_id: P000123
[Merge] Merging 2 regions for global_id: P000123
[Merge] Region abc123 has 5 keyframes
[Merge] Total keyframes collected: 10
[Merge] Creating new merged region with duration: 5.5s
[Merge] Deleting 2 original regions...
[Merge] Deletion complete. Current region count: 2
```

This helps verify:
- How many regions have `global_id` values
- Which regions are being merged
- Whether the merge succeeded
- If regions were actually deleted from the annotation store

## Support

For issues or questions, please refer to the [Label Studio Plugins repository](https://github.com/HumanSignal/label-studio-plugins).
