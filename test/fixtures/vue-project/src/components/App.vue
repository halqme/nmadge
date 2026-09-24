<template>
  <main>App</main>
</template>

<script>
import { plainMessage } from "../plain.js";

export default { message: plainMessage };
</script>

<script setup lang="ts">
import type { Message } from "../types.ts";
import { formatMessage } from "../format.ts";

const message: Message = formatMessage();
</script>
