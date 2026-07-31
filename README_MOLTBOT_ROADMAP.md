# Moltbot

Moltbot es un sistema de control remoto doméstico compuesto por:

- Un backend en Rust.
- Una aplicación cliente en React Native con Expo.
- Autenticación mediante tokens.
- Roles `USER` y `ADMIN`.
- Ejecución remota de comandos autorizados.
- Historial, estado del sistema y terminal de resultados.
- Una futura capa de inteligencia artificial, que se integrará al final del desarrollo.

---

## Estado actual del proyecto

### Backend Rust

Actualmente se encuentra funcionando:

- Carga de variables desde `.env`.
- Tokens de administrador y usuario.
- Validación de roles.
- Endpoint `POST /auth/verify`.
- Endpoint `POST /cmd`.
- Comandos básicos.
- Comando `STATUS` con información del sistema.
- Comando `HELP` con el catálogo de comandos.
- Compilación correcta con Cargo.
- Repositorio limpio y cambios respaldados en Git.

### Frontend React Native / Expo

Actualmente se encuentra implementado:

- Pantalla de inicio de sesión.
- Configuración de la dirección del backend.
- Almacenamiento local del token.
- `AuthContext`.
- `useCommandHandler`.
- Verificación periódica del backend.
- Terminal de resultados.
- Historial de comandos.
- Sugerencias de comandos.
- Separación visual de roles.
- Panel de comandos disponibles.

---

# Roadmap de desarrollo

## Fase 1 — Estabilizar el arranque de `home.tsx`

### Objetivo

Garantizar que el frontend siempre inicie siguiendo este orden:

```text
AuthContext carga el token
→ Home carga la URL guardada
→ Home carga el historial
→ verifica /auth/verify
→ obtiene HELP
→ actualiza el rol
→ inicia el chequeo periódico
```

### Problema actual

`home.tsx` actualiza la API mediante `setApiBase()`, pero React no actualiza el estado inmediatamente.

Esto puede provocar que `checkBackend()` o `fetchHelp()` se ejecuten con una URL vacía o antigua.

### Trabajo previsto

- Agregar un estado `initialized`.
- Separar la carga local y la conexión en dos efectos.
- Evitar peticiones con URL o token vacíos.
- Ejecutar `HELP` únicamente después de validar el token.
- Ejecutar `HELP` silenciosamente.
- Evitar verificaciones simultáneas.
- Evitar más de un intervalo activo.
- Limpiar correctamente intervalos y temporizadores.
- Eliminar `baseRef` y `tokRef` si dejan de ser necesarios.
- Mantener la sesión después de recargar la aplicación.

### Pruebas

- Backend encendido y token válido.
- Backend apagado.
- Token inválido.
- API no configurada.
- Recarga del navegador.
- Reinicio de la aplicación.
- Cierre de sesión.
- Nuevo inicio de sesión.

### Commit previsto

```text
fix(home): stabilize startup and backend verification
```

---

## Fase 2 — Unificar los comandos con `HELP`

### Objetivo

Convertir al backend en la fuente principal de los comandos disponibles.

### Catálogo actual del backend

#### USER

```text
PING
TIME
PROCESOS
WHOAMI
SYSINFO
STATUS
HELP
VERSION
```

#### ADMIN

```text
NOTA
VSCODE
CHROME
PS
```

### Problema actual

El frontend todavía mantiene listas locales antiguas y contiene comandos que el backend no implementa:

```text
RESTART
SHUTDOWN
KILL
```

También trata `PS` como comando general, aunque en el backend es exclusivo de administrador.

### Trabajo previsto

- Usar la respuesta de `HELP` para construir el panel.
- Usar `HELP` para las sugerencias.
- Usar `HELP` para validar el historial.
- Filtrar comandos según el rol.
- Mantener una lista local únicamente como respaldo.
- Preparar soporte para comandos que requieren argumentos.
- Preparar metadatos para comandos sensibles.

### Commit previsto

```text
refactor(commands): use backend catalog as source of truth
```

---

## Fase 3 — Mejorar el historial

### Objetivo

Guardar la línea completa ejecutada, incluyendo argumentos.

Ejemplo correcto:

```text
PS Get-Process
```

En lugar de guardar únicamente:

```text
PS
```

### Estructura propuesta

```ts
type HistoryEntry = {
  command: string;
  argument: string;
  commandLine: string;
  count: number;
  lastUsedAt: number;
};
```

### Trabajo previsto

- Guardar comandos con argumentos.
- Crear una nueva versión del esquema local.
- Migrar el historial existente.
- Evitar actualizaciones de estado anidadas.
- Evitar escrituras fuera de orden en AsyncStorage.
- Mostrar comandos recientes.
- Mantener estadísticas de uso.

### Commit previsto

```text
fix(history): preserve commands and arguments
```

---

## Fase 4 — Separar sesión y configuración local

### Objetivo

Evitar que cerrar sesión elimine automáticamente la configuración completa de la aplicación.

### Acciones que deben existir por separado

```text
Cerrar sesión
Limpiar historial
Olvidar servidor
Restablecer aplicación
```

### Trabajo previsto

- `logout`: borrar únicamente el token.
- `clearHistory`: borrar únicamente el historial.
- `forgetServer`: borrar únicamente la dirección del backend.
- `resetApp`: borrar toda la configuración con confirmación.

### Commit previsto

```text
refactor(session): separate logout from local reset
```

---

## Fase 5 — Mejorar el panel y la terminal

### Objetivo

Completar las funciones visuales y operativas que actualmente están incompletas.

### Trabajo previsto

- Mostrar `systemStatus`.
- Mostrar la última comprobación del backend.
- Añadir botón para copiar la salida.
- Añadir botón para limpiar la terminal.
- Mostrar comandos recientes.
- Mejorar el formato de errores.
- Eliminar JSON de depuración innecesario.
- Añadir confirmación para comandos administrativos.
- Mostrar estados de carga más claros.
- Eliminar código realmente muerto.

### Commit previsto

```text
feat(panel): improve terminal and system status
```

---

## Fase 6 — Documentar el contrato de la API

### Objetivo

Definir exactamente qué intercambian el frontend y el backend.

### Endpoints principales

```text
POST /auth/verify
POST /cmd
```

### Ejemplo de verificación

```json
{
  "token": "TOKEN"
}
```

Respuesta:

```json
{
  "ok": true,
  "response": "TOKEN_OK",
  "role": "ADMIN"
}
```

### Ejemplo de comando

```json
{
  "token": "TOKEN",
  "message": "PING"
}
```

Respuesta:

```json
{
  "ok": true,
  "role": "ADMIN",
  "command": "PING",
  "argument": "",
  "response": "PONG"
}
```

### Aspectos que deben documentarse

- Formato de errores.
- Códigos HTTP.
- Rol del usuario.
- Unidad de `ram_used`.
- Unidad de `ram_total`.
- Formato del comando `STATUS`.
- Formato del comando `HELP`.
- Comandos disponibles por rol.
- Comandos que requieren argumentos.

### Archivos previstos

```text
docs/API.md
src/types/api.ts
```

### Commit previsto

```text
docs(api): define authentication and command contracts
```

---

## Fase 7 — Pruebas automáticas

### Backend

Casos mínimos:

```text
Token ADMIN válido
Token USER válido
Token inválido
Token vacío
PING
HELP
STATUS
Comando desconocido
Comando ADMIN ejecutado por USER
PS sin argumento
```

Comandos de validación:

```powershell
cargo fmt --check
cargo check --all-targets
cargo test --all-targets
cargo clippy --all-targets
```

### Frontend

Casos mínimos:

```text
Carga de sesión
Backend offline
Token inválido
URL inválida
HELP mal formado
Doble pulsación
Historial
Migración del historial
Cerrar sesión
Recargar la aplicación
```

Comandos de validación:

```powershell
npx tsc --noEmit
npm run lint
```

### Commits previstos

```text
test(auth): cover authentication flows
test(commands): cover permissions and command responses
ci: validate frontend and backend
```

---

## Fase 8 — Seguridad para acceso remoto

### Objetivo

Permitir el uso desde el celular sin exponer directamente el servidor a Internet.

### Arquitectura recomendada

```text
PC con backend Rust
↕
Tailscale
↕
Celular con Moltbot
```

### Trabajo previsto

- Rotar tokens actuales.
- Usar secretos largos y aleatorios.
- Mantener `.env` fuera de Git.
- Crear `.env.example`.
- Registrar intentos fallidos.
- Añadir auditoría de comandos.
- Añadir límite de solicitudes.
- Confirmar acciones sensibles.
- Restringir el comando `PS`.
- No abrir directamente el puerto `8080` a Internet.

### Comandos especialmente sensibles

```text
PS
NOTA
VSCODE
CHROME
```

El comando `PS` deberá limitarse antes del acceso remoto, porque permite ejecutar instrucciones de PowerShell.

### Commits previstos

```text
security(auth): rotate and validate access tokens
security(commands): restrict administrative execution
feat(remote): support private Tailscale access
```

---

## Fase 9 — Aplicación Android estable

### Objetivo

Pasar de una aplicación en desarrollo a una aplicación instalable y utilizable desde el celular.

### Trabajo previsto

- Probar en Expo Go.
- Crear development build.
- Generar APK.
- Mejorar manejo de conectividad.
- Guardar la configuración del servidor.
- Mostrar errores de red claros.
- Añadir reconexión manual.
- Preparar notificaciones.
- Evaluar soporte para varios servidores.

### Commits previstos

```text
feat(mobile): improve remote server configuration
build(android): add development APK workflow
```

---

## Fase 10 — Capa de inteligencia artificial

Esta fase se realizará únicamente cuando el sistema remoto sea estable y seguro.

### Principio de seguridad

La IA no debe ejecutar directamente comandos arbitrarios en PowerShell.

Flujo recomendado:

```text
Usuario desde el celular
→ asistente
→ selección de herramienta autorizada
→ validación de permisos
→ confirmación
→ ejecución controlada
→ resultado
```

### Ejemplo futuro

El usuario solicita:

```text
Revisa por qué falla el frontend.
```

El asistente podría:

```text
Leer los archivos autorizados
Ejecutar TypeScript
Ejecutar pruebas
Analizar logs
Preparar un diff
Solicitar autorización para crear un commit
```

No debe hacerse:

```text
La IA genera cualquier comando
→ PowerShell lo ejecuta directamente
```

### Commit previsto

```text
feat(assistant): add controlled AI task orchestration
```

---

# Orden de implementación

```text
1. Estabilizar el arranque de home.tsx
2. Unificar comandos con HELP
3. Mejorar historial
4. Separar logout y reset
5. Mejorar panel y terminal
6. Documentar contrato API
7. Añadir pruebas
8. Reforzar seguridad
9. Configurar acceso remoto privado
10. Crear aplicación Android estable
11. Integrar la capa de IA
```

---

# Próxima tarea

La siguiente tarea oficial del proyecto es:

```text
fix(home): stabilize startup and backend verification
```

Antes de modificar `home.tsx`:

```powershell
cd C:\Users\corre\Desktop\reactNativeMoltbot

git status
git branch --show-current
git log --oneline -5
```

Después crear una rama:

```powershell
git switch -c fix/home-startup
```

Y trabajar únicamente en la inicialización de `home.tsx`, sin mezclar todavía historial, diseño o nuevos comandos.

---

# Reglas de trabajo

- Crear commits pequeños.
- Un objetivo por commit.
- Ejecutar pruebas antes de cada commit.
- No usar `git add .` sin revisar previamente los cambios.
- No subir `.env`.
- No guardar tokens dentro del código.
- No ejecutar `push` hasta comprobar el estado.
- Mantener backend y frontend en repositorios separados.
- La capa de IA permanece al final del roadmap.
