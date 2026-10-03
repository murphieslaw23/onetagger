<template>
  <section class="page" v-if="mix">
    <router-link to="/" class="back-link"><q-icon name="mdi-arrow-left" /> Back to library</router-link>

    <div class="detail-hero">
      <div class="detail-cover">
        <ArtworkFrame :src="mix.artwork[0]?.url" :alt="mix.title" />
        <span class="corner-tag">{{ mix.status }}</span>
      </div>

      <div class="detail-title">
        <p class="kicker">{{ mix.recordedAt?.slice(0, 4) || 'DATE UNKNOWN' }} / {{ mix.location || 'LOCATION UNKNOWN' }}</p>
        <h1>{{ mix.title }}</h1>
        <h2>{{ mix.artists.join(' · ') || 'Unknown artist' }}</h2>
        <p class="crew-line" v-if="mix.crews.length">{{ mix.crews.join(' / ') }}</p>

        <div class="detail-sources">
          <a
            v-for="source in mix.sources"
            :key="source.provider + source.url"
            class="source-link"
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="'Open source: ' + source.url"
          >
            <SourceBadge :provider="source.provider" />
            <q-icon name="mdi-open-in-new" size="12px" />
          </a>
        </div>

        <div class="detail-actions">
          <button class="btn btn--primary" :disabled="enriching" @click="runEnrichment">
            <q-icon :name="enriching ? 'mdi-loading mdi-spin' : 'mdi-database-sync-outline'" />
            {{ enriching ? 'Enriching…' : 'Enrich missing metadata' }}
          </button>
          <button v-if="!mix.artwork.length" class="btn" type="button" :aria-expanded="showSoundCloudLink" aria-controls="soundcloud-cover-link" @click="toggleSoundCloudLink">
            <q-icon name="mdi-image-plus-outline" /> Add cover from SoundCloud link
          </button>
          <router-link v-if="pendingCandidates.length" to="/review" class="btn">
            <q-icon name="mdi-source-merge" /> Review {{ pendingCandidates.length }} conflict{{ pendingCandidates.length === 1 ? '' : 's' }}
          </router-link>
          <button v-else-if="mix.status === 'review'" class="btn" @click="markCurrentReviewed">
            <q-icon name="mdi-check" /> Mark reviewed
          </button>
        </div>

        <section v-if="showSoundCloudLink && !mix.artwork.length" id="soundcloud-cover-link" class="soundcloud-cover-link" aria-label="Add SoundCloud cover">
          <strong>Have a public SoundCloud link for this mix?</strong>
          <p>Preview its track cover without an API account. Confirm the preview belongs to this mix before using it.</p>
          <form @submit.prevent="previewCover">
            <label for="soundcloud-cover-url">SoundCloud track URL</label>
            <div class="soundcloud-cover-link__form">
              <input id="soundcloud-cover-url" v-model.trim="soundCloudUrl" type="url" required placeholder="https://soundcloud.com/artist/mix" autocomplete="url" @input="clearCoverPreview" />
              <button class="btn" type="submit" :disabled="previewing">{{ previewing ? 'Checking…' : 'Preview cover' }}</button>
            </div>
          </form>
          <p v-if="coverError" class="soundcloud-cover-link__error" role="alert">{{ coverError }}</p>
          <div v-if="coverPreview" class="soundcloud-cover-link__preview">
            <img :src="coverPreview.artworkUrl" :alt="'SoundCloud cover for ' + (coverPreview.title || 'track')" />
            <div>
              <small>SOUNDCLOUD PREVIEW</small>
              <strong>{{ coverPreview.title || 'Public track' }}</strong>
              <button class="btn btn--primary" type="button" @click="confirmCover">Use this cover</button>
            </div>
          </div>
        </section>

        <div class="detail-stats">
          <div><span>DURATION</span><strong>{{ duration }}</strong></div>
          <div><span>CONFIDENCE</span><strong>{{ Math.round(mix.confidence * 100) }}%</strong></div>
          <div><span>COMPLETE</span><strong>{{ Math.round(mix.completeness * 100) }}%</strong></div>
          <div><span>LOUDNESS</span><strong>{{ mix.loudnessLufs !== undefined ? mix.loudnessLufs + ' LUFS' : '—' }}</strong></div>
        </div>
      </div>
    </div>

    <section v-if="missingFields.length" class="missing-strip" aria-label="Missing metadata">
      <span>MISSING</span>
      <b v-for="field in missingFields" :key="field">{{ field }}</b>
    </section>

    <section class="signal-panel">
      <div class="panel-head"><span>AUDIO ANALYSIS</span><b>{{ mix.bpmRange || mix.loudnessLufs !== undefined ? 'METRICS / WAVEFORM PENDING' : 'NOT RUN' }}</b></div>
      <WaveformStrip />
      <div class="signal-footer">
        <span>{{ mix.bpmRange ? mix.bpmRange.join('–') + ' BPM' : 'BPM pending' }}</span>
        <span>{{ mix.genres.concat(mix.styles).join(' / ') || 'Genre pending' }}</span>
      </div>
    </section>

    <div class="detail-grid">
      <section class="panel">
        <div class="panel-head"><span>CANONICAL RECORD</span><b>METADATA</b></div>
        <dl class="meta-table">
          <div><dt>ARTIST</dt><dd>{{ mix.artists.join(' · ') || '—' }}</dd></div>
          <div><dt>CREW / SYSTEM</dt><dd>{{ mix.crews.join(' · ') || '—' }}</dd></div>
          <div><dt>EVENT</dt><dd>{{ mix.event || '—' }}</dd></div>
          <div><dt>VENUE</dt><dd>{{ mix.venue || '—' }}</dd></div>
          <div><dt>LOCATION</dt><dd>{{ mix.location || '—' }}</dd></div>
          <div><dt>RECORDED</dt><dd>{{ mix.recordedAt || '—' }}</dd></div>
          <div><dt>UPDATED</dt><dd>{{ updatedLabel }}</dd></div>
        </dl>
        <p class="description" :class="{ 'description--empty': !mix.description }">
          {{ mix.description || 'No description indexed yet. Use enrichment to search the remaining providers.' }}
        </p>
      </section>

      <section class="panel">
        <div class="panel-head"><span>{{ mix.provenance.length }} CLAIMS</span><b>PROVENANCE</b></div>
        <div v-if="mix.provenance.length" class="prov-list">
          <article v-for="(item, index) in mix.provenance" :key="item.field + item.provider + item.sourceUrl + index">
            <SourceBadge :provider="item.provider" />
            <div>
              <strong>{{ item.field }}</strong>
              <small>{{ Math.round(item.confidence * 100) }}% confidence</small>
            </div>
          </article>
        </div>
        <div v-else class="panel-empty">
          <strong>No provenance claims yet.</strong>
        </div>
      </section>
    </div>

    <section v-if="mix.entities.length" class="panel entity-panel">
      <div class="panel-head"><span>ARTISTS & CREWS</span><b>ENTITY PROFILES</b></div>
      <article v-for="entity in mix.entities" :key="entity.kind + entity.externalId" class="entity-row">
        <img v-if="entity.imageUrl" :src="entity.imageUrl" :alt="entity.name" loading="lazy" />
        <div>
          <small>{{ entity.kind.toUpperCase() }} · {{ entity.provider || 'SOURCE' }}</small>
          <h3>{{ entity.name }}</h3>
          <p v-if="entity.profile">{{ entity.profile }}</p>
          <a v-if="entity.url" :href="entity.url" target="_blank" rel="noopener noreferrer">View entity source <q-icon name="mdi-open-in-new" size="12px" /></a>
        </div>
      </article>
    </section>

    <section class="panel candidate-panel" v-if="pendingCandidates.length">
      <div class="panel-head"><span>{{ pendingCandidates.length }} PENDING</span><b>ENRICHMENT CONFLICTS</b></div>
      <article v-for="candidate in pendingCandidates" :key="candidate.id" class="inline-candidate">
        <div><SourceBadge :provider="candidate.provider" /><strong>{{ Math.round(candidate.confidence * 100) }}%</strong></div>
        <div>
          <p>{{ candidate.reasons.join(' · ') }}</p>
          <small class="candidate-fields">Fields: {{ Object.keys(candidate.fields).join(', ') }}</small>
        </div>
        <div class="inline-candidate__actions">
          <button class="btn" @click="rejectCandidate(candidate, mix!)">Reject</button>
          <button class="btn btn--primary" @click="applyCandidate(mix!, candidate)">Accept</button>
        </div>
      </article>
    </section>
  </section>

  <section v-else class="page empty-state">
    <strong>Mix set not found.</strong>
    <router-link to="/" class="btn">Return to library</router-link>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useQuasar } from 'quasar';
import ArtworkFrame from '../components/ArtworkFrame.vue';
import SourceBadge from '../components/SourceBadge.vue';
import WaveformStrip from '../components/WaveformStrip.vue';
import { useMixStore } from '../composables/useMixStore';
import { previewSoundCloudArtwork } from '../services/api';

const route = useRoute();
const $q = useQuasar();
const {
  findMix,
  applyCandidate,
  rejectCandidate,
  markReviewed,
  enrichMixRecord,
  useSoundCloudCover,
} = useMixStore();

const enriching = ref(false);
const previewing = ref(false);
const showSoundCloudLink = ref(false);
const soundCloudUrl = ref('');
const coverError = ref('');
const coverPreview = ref<Awaited<ReturnType<typeof previewSoundCloudArtwork>> | null>(null);
const coverPreviewMixId = ref<string | null>(null);
const mix = computed(() => findMix(String(route.params.id)));
const pendingCandidates = computed(() => mix.value?.candidates.filter((candidate) => candidate.state === 'pending') ?? []);

const duration = computed(() => {
  if (!mix.value?.durationMs) return 'Unknown';
  const total = Math.floor(mix.value.durationMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
});

const missingFields = computed(() => {
  if (!mix.value) return [];
  const missing: string[] = [];
  if (!mix.value.artwork.length) missing.push('artwork');
  if (!mix.value.description) missing.push('description');
  if (!mix.value.recordedAt) missing.push('date');
  if (!mix.value.genres.length && !mix.value.styles.length) missing.push('genre');
  if (!mix.value.crews.length) missing.push('crew/system');
  if (!mix.value.event) missing.push('event');
  if (!mix.value.location) missing.push('location');
  if (!mix.value.durationMs) missing.push('duration');
  return missing;
});

const updatedLabel = computed(() => {
  if (!mix.value?.updatedAt) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(mix.value.updatedAt));
});

async function runEnrichment() {
  if (!mix.value || enriching.value) return;
  enriching.value = true;
  try {
    const summary = await enrichMixRecord(mix.value);
    const filled = summary.filledFields.length ? summary.filledFields.join(', ') : 'no missing fields';
    const review = summary.reviewCandidatesAdded ? ` · ${summary.reviewCandidatesAdded} conflict(s) queued for review` : '';
    const failed = summary.failures.length ? ` · ${summary.failures.length} provider(s) unavailable` : '';
    $q.notify({ message: `Enrichment finished: ${filled}${review}${failed}`, position: 'top-right', timeout: 5000 });
  } catch (error) {
    $q.notify({ type: 'negative', message: error instanceof Error ? error.message : 'Enrichment failed' });
  } finally {
    enriching.value = false;
  }
}

function markCurrentReviewed() {
  if (!mix.value) return;
  markReviewed(mix.value);
  $q.notify({ message: 'Canonical record marked reviewed', position: 'top-right' });
}

function clearCoverPreview() {
  coverPreview.value = null;
  coverPreviewMixId.value = null;
  coverError.value = '';
}

function toggleSoundCloudLink() {
  showSoundCloudLink.value = !showSoundCloudLink.value;
  clearCoverPreview();
}

async function previewCover() {
  if (!mix.value || previewing.value) return;
  const requestedUrl = soundCloudUrl.value;
  const requestedMixId = mix.value.id;
  previewing.value = true;
  clearCoverPreview();
  try {
    const result = await previewSoundCloudArtwork(requestedUrl);
    if (soundCloudUrl.value === requestedUrl && mix.value?.id === requestedMixId && showSoundCloudLink.value) {
      coverPreview.value = result;
      coverPreviewMixId.value = requestedMixId;
    }
  } catch (error) {
    if (soundCloudUrl.value === requestedUrl && mix.value?.id === requestedMixId && showSoundCloudLink.value) {
      coverError.value = error instanceof Error ? error.message : 'SoundCloud cover lookup failed';
    }
  } finally {
    previewing.value = false;
  }
}

function confirmCover() {
  if (!mix.value || !coverPreview.value || coverPreviewMixId.value !== mix.value.id) return;
  try {
    useSoundCloudCover(mix.value, coverPreview.value.sourceUrl, coverPreview.value.artworkUrl);
    coverPreview.value = null;
    showSoundCloudLink.value = false;
    $q.notify({ message: 'SoundCloud cover added without replacing other metadata', position: 'top-right' });
  } catch (error) {
    coverError.value = error instanceof Error ? error.message : 'Could not add SoundCloud cover';
  }
}
</script>
