import { ProfileUpdate, TeamUpdate } from '../contracts';
import { ApiError, now, id } from './coordinator';
export async function profile(env:Env,userId:string) {
  const [profile,team]=await Promise.all([
    env.DB.prepare('SELECT display_name,public,moderated FROM profiles WHERE user_id=?').bind(userId).first(),
    env.DB.prepare('SELECT t.id,t.name,t.moderated FROM teams t JOIN membership m ON m.team_id=t.id WHERE m.user_id=?').bind(userId).first()
  ]);return {profile,team};
}
export async function saveProfile(env:Env,userId:string,payload:unknown) {
  const p=ProfileUpdate.parse(payload);
  await env.DB.prepare(`INSERT INTO profiles (user_id,display_name,public,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,public=excluded.public,updated_at=excluded.updated_at`)
    .bind(userId,p.display_name,p.public?1:0,now()).run();return profile(env,userId);
}
export async function directory(env:Env) {
  const [people,teams]=await Promise.all([
    env.DB.prepare(`SELECT p.user_id AS id,p.display_name,COALESCE(SUM(c.amount),0) AS credit,COUNT(c.attempt_id) AS checked
      FROM profiles p LEFT JOIN guests g ON g.user_id=p.user_id LEFT JOIN credit c ON c.guest_id=g.id
      WHERE p.public=1 AND p.moderated=0 GROUP BY p.user_id ORDER BY credit DESC,p.user_id LIMIT 100`).all(),
    env.DB.prepare(`SELECT t.id,t.name,COUNT(DISTINCT p.user_id) AS members,COALESCE(SUM(c.amount),0) AS credit FROM teams t
      LEFT JOIN membership m ON m.team_id=t.id LEFT JOIN profiles p ON p.user_id=m.user_id AND p.public=1 AND p.moderated=0
      LEFT JOIN guests g ON g.user_id=p.user_id LEFT JOIN credit c ON c.guest_id=g.id
      WHERE t.moderated=0 GROUP BY t.id ORDER BY credit DESC,t.id LIMIT 100`).all()
  ]);return {people:people.results,teams:teams.results};
}
export async function changeTeam(env:Env,userId:string,payload:unknown) {
  const choice=TeamUpdate.parse(payload);
  if('leave' in choice){await env.DB.prepare('DELETE FROM membership WHERE user_id=?').bind(userId).run();return {team:null};}
  if('create' in choice){
    const existing=await env.DB.prepare('SELECT id FROM teams WHERE owner_id=?').bind(userId).first();
    if(existing)throw new ApiError(409,'You already own a team. Join it or ask the owner to close it.');
    const teamId=id();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO teams (id,name,owner_id,created_at) VALUES (?,?,?,?)').bind(teamId,choice.create,userId,now()),
      env.DB.prepare('INSERT INTO membership (user_id,team_id,joined_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id,joined_at=excluded.joined_at').bind(userId,teamId,now())
    ]);return {team:teamId};
  }
  const team=await env.DB.prepare('SELECT id FROM teams WHERE id=? AND moderated=0').bind(choice.join).first();
  if(!team)throw new ApiError(404,'This team is unavailable.');
  await env.DB.prepare('INSERT INTO membership (user_id,team_id,joined_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET team_id=excluded.team_id,joined_at=excluded.joined_at').bind(userId,choice.join,now()).run();
  return {team:choice.join};
}
