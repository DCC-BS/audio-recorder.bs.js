<script setup lang="ts">

const { locale, locales, setLocale } = useI18n();

const changeLocale = (newLocale: "en" | "de") => {
    setLocale(newLocale);
};

const items = computed(() =>
    locales.value.map((loc) => loc.code,
    ),
);
</script>

<template>
    <UApp>
        <USelectMenu :items="items" v-model:model-value="locale" @update:model-value="changeLocale"
            class="absolute top-4 right-4" />

        <NuxtPage />
    </UApp>
</template>