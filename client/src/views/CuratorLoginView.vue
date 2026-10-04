<template>
 <section class="page"><header class="page-hero page-hero--compact"><div><p class="kicker">CURATOR ACCESS</p><h1>{{ catalog.state.authenticated ? 'Archive curator' : 'Log in to curate' }}</h1><p class="hero-copy">Browse the archive publicly. Curator access enables imports, edits, enrichment and Review.</p></div></header>
 <section class="panel curator-panel">
  <form v-if="!catalog.state.authenticated" @submit.prevent="login"><label class="field-label" for="curator-password">CURATOR PASSWORD</label><input id="curator-password" v-model="password" type="password" autocomplete="current-password" required :disabled="busy"/><p v-if="!catalog.state.configured">Curator access has not been configured on the worker.</p><button class="btn btn--primary" :disabled="busy || !catalog.state.configured">{{ busy?'Logging in…':'Log in' }}</button></form>
  <div v-else><p>You are logged in. Changes are saved to the shared archive.</p><button class="btn" :disabled="busy" @click="logout">Log out</button></div>
  <p v-if="error" class="form-error" role="alert">{{ error }}</p>
 </section>
 <section v-if="catalog.state.authenticated" class="panel curator-panel"><div class="panel-head"><span>BROWSER LIBRARY</span><b>MIGRATE TO SHARED ARCHIVE</b></div><p>{{ localCount }} real records found in this browser. Your local originals are retained.</p><button class="btn btn--primary" :disabled="busy || !localCount" @click="migrate">{{ busy?'Migrating…':'Migrate browser records' }}</button>
  <div v-if="catalog.state.migration"><p>{{ migrationSummary }}</p><ul><li v-for="outcome in catalog.state.migration.outcomes" :key="outcome.legacyId"><router-link v-if="outcome.recordId" :to="'/mix/'+encodeURIComponent(outcome.recordId)">{{ outcome.legacyId }}</router-link><span v-else>{{ outcome.legacyId }}</span> — {{ outcome.status }}<span v-if="outcome.message">: {{ outcome.message }}</span></li></ul></div>
 </section></section>
</template>
<script setup lang="ts">
import {computed,ref,onMounted} from 'vue';import {useRouter,useRoute} from 'vue-router';import {useCatalogStore} from '../catalog/store';import {browserRecords} from '../catalog/migration';
const catalog=useCatalogStore(),router=useRouter(),route=useRoute(),password=ref(''),busy=ref(false),error=ref('');
const localCount=computed(()=>{try{return browserRecords(window.localStorage).length;}catch{return 0;}}),migrationSummary=computed(()=>{const outcomes=catalog.state.migration?.outcomes||[];return `${outcomes.filter(o=>o.status==='imported').length} imported · ${outcomes.filter(o=>o.status==='existing').length} already shared · ${outcomes.filter(o=>o.status==='error').length} need attention`;});
async function act(work:()=>Promise<unknown>){busy.value=true;error.value='';try{await work();}catch(e){error.value=e instanceof Error?e.message:'Action failed';}finally{busy.value=false;}}
async function login(){await act(async()=>{await catalog.login(password.value);password.value='';await catalog.loadReview();const target=String(route.query.returnTo||'');if(target.startsWith('/')&&!target.startsWith('//'))await router.push(target);});}
async function logout(){await act(()=>catalog.logout());}
async function migrate(){await act(()=>catalog.migrateLocalLibrary());}
onMounted(()=>void catalog.session().catch(()=>{}));
</script>
