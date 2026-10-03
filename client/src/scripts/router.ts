import { createRouter, createWebHistory } from 'vue-router';

import ImportView from '../views/ImportView.vue';
import LocalTaggerView from '../views/LocalTaggerView.vue';
import CatalogIndexView from '../views/CatalogIndexView.vue';
import CatalogDetailView from '../views/CatalogDetailView.vue';
import CuratorLoginView from '../views/CuratorLoginView.vue';
import ReviewView from '../views/ReviewView.vue';
import ProvidersView from '../views/ProvidersView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'library', component: CatalogIndexView },
    { path: '/catalog/:kind', name: 'catalog-index', component: CatalogIndexView },
    { path: '/catalog/records/:id', name: 'catalog-record', component: CatalogDetailView },
    { path: '/import', name: 'import', component: ImportView },
    { path: '/local-tags', name: 'local-tags', component: LocalTaggerView },
    { path: '/mix/:id', name: 'mix', component: CatalogDetailView },
    { path: '/entity/:id', name: 'entity', component: CatalogDetailView },
    { path: '/event/:id', name: 'event', component: CatalogDetailView },
    { path: '/review', name: 'review', component: ReviewView },
    { path: '/providers', name: 'providers', component: ProvidersView },
    { path: '/login', name: 'login', component: CuratorLoginView },
  ],
});

export default router;
