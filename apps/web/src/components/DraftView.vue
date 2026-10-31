<script setup lang="ts">
import PlanView from './PlanView.vue'
import WallView from './WallView.vue'
import { ui } from '../state/project'
</script>

<template>
  <WallView v-if="ui.draftTab !== 'plan'" />
  <PlanView v-else />
</template>
