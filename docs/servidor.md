# Servidor de la liga (Firebase, gratis)

Con un servidor, todo el equipo registra y ve los partidos de la liga. Solo hace falta **una contraseña**: no hay
cuentas ni registros. Se crea una vez (unos 10 minutos) y después se comparte un enlace de invitación.

Firebase es un servicio de Google. El plan gratuito (Spark) da de sobra para una liga: 50 000 lecturas y
20 000 escrituras al día y 1 GB de datos. **No pide tarjeta.** A diferencia de Cloudflare, no le afectan los
bloqueos de LaLiga durante los partidos de fútbol.

## 1. Crear el proyecto

1. Entra en <https://console.firebase.google.com> con una cuenta de Google y pulsa **Crear un proyecto**.
2. Nombre: por ejemplo `voley-mi-liga`. Puedes **desactivar Google Analytics** (no hace falta). Crear.

## 2. Activar el acceso anónimo

Es lo que permite usar solo la contraseña de la liga: cada móvil entra de forma anónima e invisible.

1. Menú de la izquierda → **Compilación → Authentication** → **Comenzar**.
2. Pestaña **Método de acceso** → **Anónimo** → **Habilitar** → Guardar.

## 3. Crear la base de datos

1. Menú → **Compilación → Firestore Database** → **Crear base de datos**.
2. Edición **Standard**, ubicación **europe-west1 (Bélgica)** o `eur3 (Europa)`. Siguiente.
3. **Iniciar en modo de producción** → Crear.
4. Pestaña **Reglas**: borra lo que hay, pega esto y pulsa **Publicar**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Cada liga vive en /c/<clave>, donde la clave sale de la contraseña de la liga (SHA-256).
    // Quien conoce la contraseña puede leer y escribir su liga. Nadie puede listar las ligas.
    match /c/{club}/{coleccion}/{doc} {
      allow read, write: if request.auth != null
        && club.size() == 64
        && coleccion in ['club', 'partidos', 'video'];
    }
  }
}
```

## 4. Copiar la configuración a la app

1. Rueda dentada (arriba a la izquierda) → **Configuración del proyecto** → pestaña **General**.
2. Abajo, en **Tus apps**, pulsa el icono **`</>`** (web). Apodo: `voley-app`. **No** marques Hosting.
   Registrar app.
3. Verás un bloque con `firebaseConfig`. Solo hacen falta dos datos:
   - `projectId: "voley-mi-liga"`
   - `apiKey: "AIza…"`

   (La «apiKey» de Firebase no es secreta: identifica el proyecto. Lo que protege los datos es la contraseña
   de la liga y las reglas del paso 3.)
4. En la app: pestaña **Ajustes → Servidor de la liga**. Pega el **ID del proyecto**, la **clave web**, elige una
   **contraseña de la liga** (mínimo 6 caracteres) y pon **tu nombre**.
   **Conectar**: los jugadores, rivales y partidos de esa liga se suben al servidor.

## 5. Invitar al equipo

En la misma ventana, **Compartir enlace de invitación**: se abre el menú de compartir del móvil (WhatsApp…).
Quien abre el enlace escribe **su nombre**, pulsa **Unirme** y ya tiene la liga con sus jugadores y partidos. Su
nombre queda guardado en cada partido y punto que registre (en Ajustes → Servidor de la liga ves quién ha registrado).

**iPhone con la app en la pantalla de inicio**: los enlaces se abren en Safari, no en la app. Desde la app:
**Ajustes → Servidor de la liga → Tengo un enlace de invitación** (o el menú de ligas → **Unirme a una liga con un
enlace**) y pega el enlace. Lo mismo para el enlace de «otro dispositivo mío» de quien administra.

El enlace lleva la contraseña. Si se filtra, cámbiala con **Cambiar la contraseña de la liga** (solo quien conectó la
liga, que la administra): todo pasa a la contraseña nueva, la antigua deja de funcionar y hay que mandar el enlace
nuevo al equipo. Quien entra con el enlace es miembro: no ve la contraseña, no invita y no puede borrar partidos
compartidos.

## Cómo funciona

- **Cada liga tiene su servidor y su contraseña.** La configuración se guarda en el dispositivo y solo la usa esa
  liga; otras ligas de la app no se ven afectadas. Tampoco se incluye en las copias de seguridad.
- **Cuándo se sincroniza**: al abrir la app, al cerrar cada set, al recuperar la conexión y con **Sincronizar
  ahora**. Sin conexión (pabellones) se sigue registrando normal y se sube después.
- **Nunca se sobrescribe**: si dos personas registran el mismo partido a la vez, la app guarda las dos versiones y
  avisa en la lista de partidos para elegir cuál conservar. Lo normal es que **una sola persona anote cada partido**.
- **Estado**: junto al nombre de la liga aparece ☁ con la hora de la última sincronización, «sin subir» si hay
  cambios pendientes o ⚠ si hay un problema (pulsa para ver el aviso).
