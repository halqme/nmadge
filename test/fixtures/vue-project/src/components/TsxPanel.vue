<template>
  <section>TSX panel</section>
</template>

<script setup lang="tsx">
import type { Message } from "../types.ts";
import Child from "./Child";

const message: Message = { text: "panel" };
const view = <Child message={message.text} />;
</script>
