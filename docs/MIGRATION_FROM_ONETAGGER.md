# Migration from OneTagger

## Reused concepts

- provider registry / builder separation
- provider-specific request wrappers, rate limits and caching concepts
- matching as ranked candidates rather than one opaque answer
- human review before committing metadata
- provider-specific configuration
- artwork and external-ID enrichment

## Retired from the active product

- individual-file scanner
- AutoTagger track loop
- QuickTag
- track renamer
- Shazam-per-track flow
- Spotify AudioFeatures flow
- desktop WebView message bridge and socket assumptions
- direct media-file tag writes as the primary persistence model

History remains in Git and upstream remains the fork parent.

## New aggregate root

`MixSet` replaces the `AudioFileInfo -> Track` workflow. It carries long duration, artist/crew/event context, multiple public sources, candidates, provenance, confidence and raw provider metadata.
