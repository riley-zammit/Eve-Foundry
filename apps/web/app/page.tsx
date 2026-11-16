import { listFactories } from "@foundry/factory/db";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { createFactory } from "./factories/actions";

export default function Home() {
    return (
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-12">
            <h1 className="text-2xl font-semibold">Foundry</h1>
            <form action={createFactory} className="flex gap-2">
                <input
                    name="name"
                    placeholder="New factory name"
                    className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                />
                <button className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white">
                    Create
                </button>
            </form>
            <Suspense fallback={<p className="text-sm text-zinc-500">Loading factories…</p>}>
                <FactoryList />
            </Suspense>
        </main>
    );
}

async function FactoryList() {
    await connection();
    const factories = await listFactories();

    if (factories.length === 0) {
        return <p className="text-sm text-zinc-500">No factories yet.</p>;
    }

    return (
        <ul className="flex flex-col divide-y divide-zinc-800 rounded-md border border-zinc-800">
            {factories.map((factory) => (
                <li key={factory.id}>
                    <Link href={`/factories/${factory.id}`} className="flex justify-between px-4 py-3 hover:bg-zinc-900">
                        <span>{factory.name}</span>
                        <span className="text-xs text-zinc-500">{factory.updatedAt.toLocaleString()}</span>
                    </Link>
                </li>
            ))}
        </ul>
    );
}
