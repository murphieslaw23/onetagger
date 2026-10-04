<template>
  <div class="app-shell">
    <aside class="side-rail">
      <router-link to="/" class="brand-mark" aria-label="SYCO23 Mixsets">
        <span class="brand-mark__sig">S//23</span>
        <span class="brand-mark__name">MIXSETS</span>
      </router-link>

      <nav class="main-nav" aria-label="Primary navigation">
        <router-link v-for="item in nav" :key="item.to" :to="item.to" class="nav-link">
          <q-icon :name="item.icon" size="20px" />
          <span>{{ item.label }}</span>
          <b v-if="item.badge">{{ item.badge }}</b>
        </router-link>
      </nav>

      <div class="rail-status">
        <span class="pulse-dot" :data-state="state.apiState"></span>
        <div>
          <small>{{ state.apiState === 'online' ? 'WORKER' : 'INDEX STATE' }}</small>
          <strong>{{ railStatus }}</strong>
        </div>
      </div>
    </aside>

    <main class="app-main">
      <div class="top-line">
        <div><span>SYCO23 / SYSTEM CORRUPT</span><b>LONGFORM SIGNAL ARCHIVE</b></div>
        <div class="top-line__right">
          <span>{{ runtimeLabel }}</span>
          <i :data-state="state.apiState"></i>
        </div>
      </div>
      <div class="mobile-runtime" :data-state="state.apiState">
        <span></span>{{ runtimeLabel }}
      </div>
      <router-view />
    </main>

    <nav class="mobile-nav" aria-label="Primary navigation">
      <router-link v-for="item in nav" :key="item.to" :to="item.to">
        <q-icon :name="item.icon" size="21px" />
        <span>{{ item.mobile }}</span>
        <b v-if="item.badge">{{ item.badge }}</b>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch }  from 'vue';
import {useCatalogStore} from './catalog/store';
import {useRouter,useRoute} from 'vue-router';
import { useMixStore } from './composables/useMixStore';
import { getDiscoveryJobs, getProviderHealth } from './services/api';

const {
  state,
  reviewCount,
  runningJobs,
  syncApiJobs,
  updateProviderHealth,
  setApiState,
} = useMixStore();

const catalog=useCatalogStore(),router=useRouter(),route=useRoute();
const loginRequired=()=>{catalog.state.authenticated=false;catalog.state.requiresLogin=true;};
watch(()=>catalog.state.requiresLogin,required=>{if(required&&route.path!=='/login')void router.push({path:'/login',query:{returnTo:route.fullPath}});});
onBeforeUnmount(()=>window.removeEventListener('mixsets-login-required',loginRequired));
const nav = computed(() => [
  { to: '/', label: 'Library', mobile: 'Library', icon: 'mdi-view-grid-outline', badge: 0 },
  ...(catalog.state.authenticated?[{ to: '/import', label: 'Import / Crawl', mobile: 'Import', icon: 'mdi-radar', badge: runningJobs.value }]:[]),
  ...(catalog.state.authenticated?[{ to: '/review', label: 'Review Queue', mobile: 'Review', icon: 'mdi-source-merge', badge: reviewCount.value }]:[]),
  { to: '/login', label: catalog.state.authenticated?'Curator':'Log in', mobile:'Curator', icon:'mdi-account-key-outline',badge:0 },
  { to: '/providers', label: 'Providers', mobile: 'Sources', icon: 'mdi-server-network-outline', badge: 0 },
]);

const runtimeLabel = computed(() => {
  if (state.apiState === 'online') return 'WORKER ONLINE';
  if (state.apiState === 'offline') return 'WORKER OFFLINE';
  return 'CHECKING WORKER…';
});

const railStatus = computed(() => {
  if (runningJobs.value) return `${runningJobs.value} ${runningJobs.value === 1 ? 'JOB' : 'JOBS'}`;
  return state.apiState === 'online' ? 'ONLINE / IDLE' : state.apiState === 'checking' ? 'CHECKING' : 'OFFLINE';
});

onMounted(async () => {
 window.addEventListener('mixsets-login-required',loginRequired);setApiState('checking');
 try{await catalog.session();const health=await getProviderHealth();updateProviderHealth(health);if(catalog.state.authenticated){syncApiJobs(await getDiscoveryJobs());await catalog.loadReview();}setApiState('online');}catch{setApiState('offline');}
});
</script>
