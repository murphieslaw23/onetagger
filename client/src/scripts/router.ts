import { createRouter, createWebHistory } from 'vue-router';

import CuratorLoginView from '../views/CuratorLoginView.vue';
import {useCatalogStore} from '../catalog/store';
import LibraryView from '../views/LibraryView.vue';
import ImportView from '../views/ImportView.vue';
import MixDetailView from '../views/MixDetailView.vue';
import ReviewView from '../views/ReviewView.vue';
import ProvidersView from '../views/ProvidersView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {path:'/login',name:'login',component:CuratorLoginView},
    { path: '/', name: 'library', component: LibraryView },
    { path: '/import', name: 'import', component: ImportView },
    { path: '/mix/:id', name: 'mix', component: MixDetailView },
    { path: '/review', name: 'review', component: ReviewView },
    { path: '/providers', name: 'providers', component: ProvidersView },
  ],
});

router.beforeEach(async(to)=>{if(['/import','/review'].includes(to.path)){const catalog=useCatalogStore();try{await catalog.session();}catch{}if(!catalog.state.authenticated)return {path:'/login',query:{returnTo:to.fullPath}};}});
export default router;
