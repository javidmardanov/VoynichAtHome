<script lang="ts">let {data}=$props();</script>
<svelte:head><title>{data.row.title} — Voynich@home</title></svelte:head>
<div class="page narrow prose"><p class="eyebrow">Published research record</p><h1>{data.row.title}</h1>
{#if data.row.withdrawn}<p class="error" role="status">Withdrawn: {data.row.withdrawal_reason}</p>{/if}
<span class="badge">{data.row.tier==='computation'?'Completed computation':data.row.tier==='candidate'?'Promising candidate':'Supported scientific conclusion'}</span>
<p class="lede">{data.report.summary}</p><p>{data.report.comparison_assessment}</p>
<h2>Limits of this result</h2><ul>{#each data.report.limitations as limitation}<li>{limitation}</li>{/each}</ul>
<h2>Evidence and reproduction</h2><p><a href={data.report.evidence_url}>Full evidence and campaign analysis ↗</a></p><p><a href={'/experiments/'+data.row.campaign_id}>Campaign assumptions and work records →</a></p>
<ul>{#each data.report.record_ids as id}<li><a href={'/api/v1/records/'+encodeURIComponent(id)}><code>{id}</code></a></li>{/each}</ul>
<h2>Recorded review</h2><p>The owner records these reviews and is responsible for checking their authenticity and scope. Software checks do not establish a scientific conclusion.</p>
{#if data.report.reviews.length}<ul>{#each data.report.reviews as review}<li>{review.name} · {review.role} · <a href={review.record_url}>Read the review ↗</a></li>{/each}</ul>{:else}<p>No external review is recorded.</p>{/if}
{#if data.report.recovery_scope.length}<h2>Reviewed recovery range</h2><p>These are declared source-work conditions. They do not establish the language or encoding of the manuscript.</p><div class="table-wrap"><table><thead><tr><th>Condition</th><th>Exact recoveries</th><th>Search budget</th></tr></thead><tbody>{#each data.report.recovery_scope as scope}<tr><td>{scope.language} · {scope.encoding} · {scope.length} characters</td><td>{scope.exact_recoveries} / {scope.cases}</td><td>{scope.starts} starts × {scope.iterations}</td></tr>{/each}</tbody></table></div>{/if}
<details><summary>Complete report manifest</summary><pre>{JSON.stringify(data.report,null,2)}</pre></details></div>
