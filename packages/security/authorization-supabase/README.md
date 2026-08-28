# Supabase resource authorization

English | [中文](README.zh.md)

`@orygin-ai/dsh-authorization-supabase` implements the server-only `ctx.resourceAuthorization` boundary. It asks a service-role-only PostgreSQL function to verify active membership and exact tenant ownership for workspaces, sessions, runs, and credentials. Denials reveal no resource metadata and browser roles cannot execute the function.
