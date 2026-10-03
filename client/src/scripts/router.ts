import { createRouter, createWebHistory } from 'vue-router';

import LibraryView from '../views/LibraryView.vue';
import ImportView from '../views/ImportView.vue';
import MixDetailView from '../views/MixDetailView.vue';
import ReviewView from '../views/ReviewView.vue';
import ProvidersView from '../views/ProvidersView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'library', component: LibraryView },
    { path: '/import', name: 'import', component: ImportView },
    { path: '/mix/:id', name: 'mix', component: MixDetailView },
    { path: '/review', name: 'review', component: ReviewView },
    { path: '/providers', name: 'providers', component: ProvidersView },
  ],
});

export default router;
