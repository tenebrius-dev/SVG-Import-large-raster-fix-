# SVG Import — инструкции проекта

## Память проекта Obsidian Mind

- Репозиторий подключён к общей памяти Obsidian Mind через глобальный MCP-сервер `om`; его идентичность объявлена в `.om-project`.
- Перед изменением SVG parsing, viewBox, transforms, clipping, masks, text, embedded images, физического размера или large-raster fallback обращайтесь к `om` через `search` и `expand` за зафиксированными решениями и gotchas. Результат указывайте в плане или work note; если записей нет, пишите `nothing recorded on this`.
- Используйте `record_work` для итогов, специфичных для проекта, а `remember` — только для обобщаемых выводов. Не помещайте в этот репозиторий заметки vault или credentials.
