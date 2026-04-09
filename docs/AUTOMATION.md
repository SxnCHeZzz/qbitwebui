# Automation Rule Engine

Модуль автоматизации управления торрентами для qBittorrent Web UI.

## Функциональность

- **Условия (Conditions)**: Проверка через json-logic-js (status, ratio, time, size, category, tags, tracker, etc.)
- **Действия (Actions)**: set_category, add/remove_tag, set_limits, pause/resume, delete, move, webhook, command
- **Триггеры**: cron, torrent_added, torrent_completed, state_changed, ratio_reached, manual
- **Логика**: AND, OR, NOT, вложенные группы

## Структура файлов

### Backend (`src/server/`)

| Файл                           | Описание                                               |
| ------------------------------ | ------------------------------------------------------ |
| `db/index.ts`                  | Таблицы: automation_rules, execution_logs, rule_states |
| `db/automation.ts`             | CRUD операции и вспомогательные функции                |
| `utils/automationEvaluator.ts` | Оценка условий через json-logic-js                     |
| `utils/automationExecutor.ts`  | Выполнение действий через qBittorrent API              |
| `utils/automationScheduler.ts` | Scheduler с cron и event-триггерами                    |
| `routes/automation.ts`         | REST API endpoints                                     |

### Frontend (`src/components/`)

| Файл                        | Описание                                     |
| --------------------------- | -------------------------------------------- |
| `AutomationManager.tsx`     | Главная страница со списком правил           |
| `AutomationRuleBuilder.tsx` | Конструктор правил (создание/редактирование) |
| `AutomationRuleTester.tsx`  | Тестирование правил на mock данных           |
| `AutomationLogsViewer.tsx`  | Просмотр логов выполнения                    |
| `ToastContainer.tsx`        | Уведомления                                  |

### Hooks (`src/hooks/`)

| Файл          | Описание                   |
| ------------- | -------------------------- |
| `useToast.ts` | Hook для toast-уведомлений |

## API Endpoints

- `GET/POST/PUT/DELETE /api/automation/rules` - CRUD правил
- `POST /api/automation/rules/:id/test` - Тестирование правила
- `POST /api/automation/rules/:id/run` - Ручной запуск правила
- `GET /api/automation/rules/:id/logs` - Логи выполнения
- `GET /api/automation/examples/conditions` - Примеры условий
- `GET /api/automation/examples/actions` - Примеры действий

## JSON Logic Conditions

Примеры условий для json-logic:

```json
// Завершенный торрент
{ "==": [{ "var": "torrent.progress" }, 1] }

// Ratio больше 1.5
{ ">": [{ "var": "torrent.ratio" }, 1.5] }

// Сидирование более 7 дней
{ ">": [{ "var": "torrent.seedingHours" }, 168] }

// Сложное условие (AND)
{
  "and": [
    { "==": [{ "var": "torrent.isCompleted" }, true] },
    { ">": [{ "var": "torrent.ratio" }, 1] }
  ]
}
```

## Scheduler

- **Cron**: Периодический запуск по расписанию
- **Event-триггеры**: torrent_added, torrent_completed, state_changed, ratio_reached
- **Polling**: Каждые 30 секунд проверяются event-триггеры
- **Cleanup**: Каждый час очищаются старые логи (30 дней) и состояния (7 дней)

## Безопасность

- Rate limiting на API endpoints
- Проверка прав пользователя (userOwnsInstance)
- Дедупликация триггеров через rule_states
- Валидация json-logic conditions
- Безопасные команды только из белого списка
